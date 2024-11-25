// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws'; // type structure for the websocket object used by fastify/websocket
// import BlockStream from 'block-stream2';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import {
    MediaStreamConnectedMessage,
    MediaStreamMessage,
    isConnectedEvent,
    isStartEvent,
    isStopEvent,
    isMediaEvent,
    ExotelStartMessage,
    ExotelMediaMessage,
    ExotelStopMessage,
} from './mediastream';

import {
    CallMetaData,
    startTranscribe,
    writeCallStartEvent,
    writeCallEndEvent,
    SocketCallData,
    writeCallRecordingEvent,
    ExotelCallMetaData,
    ExotelSocketCallData,
} from './calleventdata';

import {
    // ulawToL16,
    // msToBytes,
    createWavHeader,
    getClientIP,
    posixifyFilename,
    normalizeErrorForLogging,
} from './utils';
import { PassThrough } from 'stream';
// eslint-disable-next-line @typescript-eslint/no-var-requires
// const interleave = require('interleave-stream');

const AWS_REGION = process.env['AWS_REGION'] || 'us-east-1';
const RECORDINGS_BUCKET_NAME = process.env['RECORDINGS_BUCKET_NAME'] || undefined;
const RECORDING_FILE_PREFIX = process.env['RECORDING_FILE_PREFIX'] || 'lca-audio-wav/';
const CPU_HEALTH_THRESHOLD = parseInt(process.env['CPU_HEALTH_THRESHOLD'] || '60', 10);
const LOCAL_TEMP_DIR = process.env['LOCAL_TEMP_DIR'] || '/tmp/';
const WS_LOG_LEVEL = process.env['WS_LOG_LEVEL'] || 'debug';
const WS_LOG_INTERVAL = parseInt(process.env['WS_LOG_INTERVAL'] || '120', 10);
const SHOULD_RECORD_CALL = process.env['SHOULD_RECORD_CALL'] || 'false';


// Source specific audio parameters
// const CHUNK_SIZE_IN_MS = parseInt(process.env['CHUNK_SIZE_IN_MS'] || '20', 10);

// const MULAW_BYTES_PER_SAMPLE = parseInt(process.env['MULAW_BYTES_PER_SAMPLE'] || '4', 10);

const s3Client = new S3Client({ region: AWS_REGION });

// global variable to maintain state for active connections

const socketMap = new Map<WebSocket, ExotelSocketCallData>();



// create fastify server (with logging enabled for non-PROD environments)
const server = fastify({
    logger: {
        level: WS_LOG_LEVEL,
        prettyPrint: {
            ignore: 'pid,hostname',
            translateTime: 'SYS:HH:MM:ss.l',
            colorize: false,
            levelFirst: true,
        },
    },
    disableRequestLogging: true,
});
// register the @fastify/websocket plugin with the fastify server
server.register(websocket);

// Setup preHandler hook to authenticate 
server.addHook('preHandler', async (request, ) => {
    if (!request.url.includes('health')) { 
        const clientIP = getClientIP(request.headers);
        server.log.debug(`[AUTH]: [${clientIP}] - Received preHandler hook for authentication. URI: <${request.url}>, Headers: ${JSON.stringify(request.headers)}`);
        server.log.debug('[AUTH]: Authentication TO BE IMPLEMENTED');
    }
});

// Setup Route for websocket connection
server.get('/api/v1/ws', { websocket: true, logLevel: 'debug' }, (connection, request) => {
    const clientIP = getClientIP(request.headers);
    server.log.debug(`[NEW CONNECTION]: [${clientIP}] - Received new connection request @ /api/v1/ws. URI: <${request.url}>, Headers: ${JSON.stringify(request.headers)}`);

    registerHandlers(clientIP, connection.socket); // setup the handler functions for websocket events
});

type HealthCheckRemoteInfo = {
    addr: string;
    tsFirst: number;
    tsLast: number;
    count: number;
};
const healthCheckStats = new Map<string, HealthCheckRemoteInfo>();

// Setup Route for health check 
server.get('/health/check', { logLevel: 'warn' }, (request, response) => {
    const now = Date.now();

    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    const isHealthy = cpuUsage > CPU_HEALTH_THRESHOLD ? false : true;
    const status = isHealthy ? 200 : 503;

    const remoteIp = request.socket.remoteAddress || 'unknown';
    const item = healthCheckStats.get(remoteIp);
    if (!item) {
        server.log.debug(`[HEALTH CHECK]: [${remoteIp}] - Received First health check from load balancer. URI: <${request.url}>, Headers: ${JSON.stringify(request.headers)} ==> Health Check status - CPU Usage%: ${cpuUsage}, IsHealthy: ${isHealthy}, Status: ${status}`);
        healthCheckStats.set(remoteIp, { addr: remoteIp, tsFirst: now, tsLast: now, count: 1 });
    } else {
        item.tsLast = now;
        ++item.count;
        const elapsed_seconds = Math.round((item.tsLast - item.tsFirst) / 1000);
        if ((elapsed_seconds % WS_LOG_INTERVAL) == 0) {
            server.log.debug(`[HEALTH CHECK]: [${remoteIp}] - Received Health check # ${item.count} from load balancer. URI: <${request.url}>, Headers: ${JSON.stringify(request.headers)} ==> Health Check status - CPU Usage%: ${cpuUsage}, IsHealthy: ${isHealthy}, Status: ${status}`);
        }
    }

    response
        .code(status)
        .header('Cache-Control', 'max-age=0, no-cache, no-store, must-revalidate, proxy-revalidate')
        .send({ 'Http-Status': status, 'Healthy': isHealthy });
});

// Setup handlers for websocket events - 'message', 'close', 'error'
const registerHandlers = (clientIP: string, ws: WebSocket): void => {

    ws.on('message', async (data): Promise<void> => {        
        try {
            const message: MediaStreamMessage = JSON.parse(Buffer.from(data as Uint8Array).toString('utf8'));

            if (typeof (message.event) === 'undefined') {
                server.log.error(`[ON MESSAGE]: [${clientIP}] - Undefined Event Type in the event message received from Talkdesk. Ignoring the event. ${JSON.stringify(message)}`);
            } else {
                if (isConnectedEvent(message.event)) {
                    await onConnected(clientIP, ws, message as MediaStreamConnectedMessage);
                } else if (isStartEvent(message.event)) {
                    await onStart(clientIP, ws, message as unknown as ExotelStartMessage);
                } else if (isMediaEvent(message.event)) {
                    await onMedia(clientIP, ws, message as unknown as ExotelMediaMessage);
                } else if (isStopEvent(message.event)) {
                    await onStop(clientIP, ws, message as unknown as ExotelStopMessage);
                } else {
                    server.log.error(`[ON MESSAGE]: [${clientIP}] - Invalid Event Type Event Type in the event message received from Talkdesk. Ignoring the event. ${JSON.stringify(message)}`);
                }
            }
        } catch (error) {
            server.log.error(`[ON MESSAGE]: [${clientIP}] - Error parsing event message from Talkdesk. Possible syntax error in the json payload.: ${normalizeErrorForLogging(error)}`);
        }
    });

    ws.on('close', async (code: number) => {
        try {
            await onWsClose(clientIP, ws, code);
        } catch (err) {
            server.log.error(`[ON WSCLOSE]: [${clientIP}] Error in WS close handler: ${normalizeErrorForLogging(err)}`);
        }
    });

    ws.on('error', (error: Error) => {
        server.log.error(`[ON WSERROR]: [${clientIP}] - Websocket error, forcing close: ${normalizeErrorForLogging(error)}`);
        ws.close();
    });
};

const onConnected = async (clientIP: string, ws: WebSocket, data: MediaStreamConnectedMessage): Promise<void> => {
    server.log.info(`[ON CONNECTED]: [${clientIP}] - Client connected: ${JSON.stringify(data)}`);
};

const onStart = async (clientIP: string, ws: WebSocket, data: ExotelStartMessage): Promise<void> => {
    try {
        server.log.info(`[ON START]: [${clientIP}][${data.start.call_sid}] - Received Start event from Exotel client:`, {
            startData: data
        });

        // Validate required data
        if (!data.start || !data.start.call_sid) {
            throw new Error('Missing required start data or call_sid');
        }

        server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Creating call metadata`);
        
        const callMetaData: ExotelCallMetaData = {
            callEvent: 'START',
            callId: data.start.call_sid,
            fromNumber: data.start.from,
            toNumber: data.start.to,
            shouldRecordCall: SHOULD_RECORD_CALL === 'true',
            samplingRate: 8000, // Fixed for Exotel
            agentId: randomUUID(),
            customParameters: data.start.custom_parameters,
            bitRate: data.start.media_format.bit_rate
        };

        server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Created call metadata:`, {
            metadata: callMetaData
        });

        // Create temp recording filename and stream
        server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Setting up recording files`);
        const tempRecordingFilename = getTempRecordingFileName(callMetaData);
        const tempFilePath = path.join(LOCAL_TEMP_DIR, tempRecordingFilename);
        
        // Ensure temp directory exists
        if (!fs.existsSync(LOCAL_TEMP_DIR)) {
            await fs.promises.mkdir(LOCAL_TEMP_DIR, { recursive: true });
        }

        server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Creating write stream for: ${tempFilePath}`);
        const writeRecordingStream = fs.createWriteStream(tempFilePath);
        const recordingFileSize = { filesize: 0 };

        // Configure streams
        server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Configuring audio streams`);
        // const highWaterMarkSize = (callMetaData.samplingRate / 10) * 2;  //removed *2 since single
        const highWaterMarkSize = 32000;  //removed *2 since single


        try {
            // Simplified stream setup for mono
            const audioInputStream = new PassThrough({ 
                highWaterMark: highWaterMarkSize,
                objectMode: false
            });

<<<<<<< HEAD
            // Create socket call map with simplified structure
=======
            server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Created audio streams with highWaterMark: ${highWaterMarkSize}`);

            // Ensure proper piping
            agentBlock.pipe(audioInputStream);
            callerBlock.pipe(audioInputStream);

            // Create socket call map
>>>>>>> parent of c9ab88a (modified watermarks for monochannel)
            const socketCallMap: SocketCallData = {
                callMetadata: callMetaData,
                audioInputStream,
                writeRecordingStream,
                recordingFileSize,
                startStreamTime: new Date(),
                ended: false
            };

            // Set up error handler
            audioInputStream.on('error', (err: Error) => {
                server.log.error(`[ON START]: [${clientIP}][${data.start.call_sid}] - Audio input stream error:`, err);
            });

            // Optional: Add buffer monitoring
            audioInputStream.on('data', (chunk: Buffer) => {
                const bufferLevel = audioInputStream.readableLength;
                if (bufferLevel > highWaterMarkSize * 0.8) {
                    server.log.warn(`[BUFFER WARNING]: [${data.start.call_sid}] High buffer level: ${bufferLevel} bytes`);
                }
            });

            socketMap.set(ws, socketCallMap);

            server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Writing call start event`);
            await writeCallStartEvent(callMetaData, server);

            server.log.debug(`[ON START]: [${clientIP}][${data.start.call_sid}] - Starting transcribe`);
            await startTranscribe(callMetaData, audioInputStream, socketCallMap, server);

            server.log.info(`[ON START]: [${clientIP}][${data.start.call_sid}] - Successfully completed start setup`);

        } catch (streamError) {
            server.log.error(`[ON START]: [${clientIP}][${data.start.call_sid}] - Error setting up streams:`, streamError);
            throw streamError;
        }

    } catch (error) {
        server.log.error(`[ON START]: [${clientIP}][${data?.start?.call_sid || 'UNKNOWN'}] - Fatal error in onStart:`, {
            error: normalizeErrorForLogging(error),
            data: data
        });
        // Clean up any partial resources
        if (ws && socketMap.has(ws)) {
            socketMap.delete(ws);
        }
        throw error;
    }
};

const onMedia = async (clientIP: string, ws: WebSocket, data: ExotelMediaMessage): Promise<void> => {
    const socketData = socketMap.get(ws) as ExotelSocketCallData;
    
    let callid = `Stream ID-${data.streamSid}`;
    if (socketData && socketData.callMetadata) {
        callid = socketData.callMetadata.callId;
    }

    if (socketData !== undefined && socketData.audioInputStream !== undefined) {
        try {
            // Decode base64 payload
            const pcmBuffer = Buffer.from(data.media.payload, 'base64');
            
            server.log.debug(`[ON MEDIA]: [${clientIP}][${callid}] - Processing audio chunk of size: ${pcmBuffer.length}`);

            // Write directly to audioInputStream
            socketData.audioInputStream.write(pcmBuffer);

            // Write to recording stream if enabled
            if (socketData.writeRecordingStream) {
                socketData.writeRecordingStream.write(pcmBuffer);
                socketData.recordingFileSize.filesize += pcmBuffer.length;
            }

        } catch (error) {
            server.log.error(`[ON MEDIA]: [${clientIP}][${callid}] - Error processing media chunk: ${normalizeErrorForLogging(error)}`);
        }
    } else {
        server.log.error(`[ON MEDIA]: [${clientIP}][${callid}] - Error: received 'media' event before receiving 'start' event`);
    }
};

const endCall = async (ws: WebSocket, callMetaData: CallMetaData|undefined, socketData: SocketCallData): Promise<void> => {
    if (callMetaData === undefined) {
        callMetaData = socketData.callMetadata;
    }

    if (socketData !== undefined && socketData.ended === false) {
        if (socketData.audioInputStream !== undefined && socketData.writeRecordingStream !== undefined &&
            socketData.recordingFileSize !== undefined) {
            
            socketData.audioInputStream.end();
            socketData.writeRecordingStream.end();

            socketData.ended = true;
            await writeCallEndEvent(callMetaData, server);
            
            const header = createWavHeader(socketData.recordingFileSize.filesize, callMetaData.samplingRate);
            const tempRecordingFilename = getTempRecordingFileName(callMetaData);
            const wavRecordingFilename = getWavRecordingFileName(callMetaData);
            const readStream = fs.createReadStream(path.join(LOCAL_TEMP_DIR, tempRecordingFilename));
            const writeStream = fs.createWriteStream(path.join(LOCAL_TEMP_DIR, wavRecordingFilename));
            
            writeStream.write(header);
            for await (const chunk of readStream) {
                writeStream.write(chunk);
            }
            writeStream.end();
    
            await writeToS3(callMetaData, tempRecordingFilename);
            await writeToS3(callMetaData, wavRecordingFilename);
            await deleteTempFile(callMetaData, path.join(LOCAL_TEMP_DIR, tempRecordingFilename));
            await deleteTempFile(callMetaData, path.join(LOCAL_TEMP_DIR, wavRecordingFilename));
    
            const url = new URL(RECORDING_FILE_PREFIX + wavRecordingFilename, `https://${RECORDINGS_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com`);
            const recordingUrl = url.href;
            
            await writeCallRecordingEvent(callMetaData, recordingUrl, server);
        }
        if (socketData.audioInputStream !== undefined) {
            server.log.debug(`[${callMetaData.callEvent} LCA EVENT]: [${callMetaData.callId}] - Closing audio input stream:  ${JSON.stringify(callMetaData)}`);
            socketData.audioInputStream.end();
            socketData.audioInputStream.destroy();
        }
        if (socketData !== undefined) {
            server.log.debug(`[${callMetaData.callEvent} LCA EVENT]: [${callMetaData.callId}] - Deleting websocket from map: ${JSON.stringify(callMetaData)}`);
            socketMap.delete(ws);
        }
    } else {
        server.log.error(`[${callMetaData.callEvent} LCA EVENT]: [${callMetaData.callId}] - Duplicate End call event. Already received the end call event: ${JSON.stringify(callMetaData)}`);

    }
};

const onStop = async (clientIP: string, ws: WebSocket, data: ExotelStopMessage): Promise<void> => {
    const socketData = socketMap.get(ws) as ExotelSocketCallData;
    
    if (!socketData || !(socketData.callMetadata)) {
        server.log.error(`[${clientIP}]: [${data.stop.call_sid}] - Received STOP without starting a call: ${JSON.stringify(data)}`);
        return;
    }

    const callMetaData: ExotelCallMetaData = {
        ...socketData.callMetadata,
        callEvent: 'END',
        reason: data.stop.reason
    };

    await endCall(ws, callMetaData, socketData);
};

const onWsClose = async (clientIP: string, ws:WebSocket, code: number): Promise<void> => {
    ws.close(code);
    const socketData = socketMap.get(ws);
    if (socketData !== undefined) {
        server.log.debug(`[ON WSCLOSE]: [${clientIP}][${socketData.callMetadata.callId}] - Writing call end event due to websocket close event ${JSON.stringify(socketData.callMetadata)}`);
        await endCall(ws, undefined, socketData);
    }
};

// Start the websocket server on default port 3000 if no port supplied in environment variables
server.listen(
    { 
        port: parseInt(process.env?.['SERVERPORT'] ?? '8080'),
        host: process.env?.['SERVERHOST'] ?? '127.0.0.1'
    },
    (err) => {
        if (err) {
            server.log.error('Error starting websocket server: ',err);
            process.exit(1);
        }
        server.log.info(`Routes: \n${server.printRoutes()}`);
    }
);


const getTempRecordingFileName = (callMetaData: CallMetaData): string => {
    return `${posixifyFilename(callMetaData.callId)}.raw`;
};

const getWavRecordingFileName = (callMetaData: CallMetaData): string => {
    return `${posixifyFilename(callMetaData.callId)}.wav`;
};

const writeToS3 = async (callMetaData: CallMetaData, tempFileName:string) => {
    const sourceFile = path.join(LOCAL_TEMP_DIR, tempFileName);

    let data;
    const fileStream = fs.createReadStream(sourceFile);
    const uploadParams = {
        Bucket: RECORDINGS_BUCKET_NAME,
        Key: RECORDING_FILE_PREFIX + tempFileName,
        Body: fileStream,
    };
    try {
        data = await s3Client.send(new PutObjectCommand(uploadParams));
        server.log.debug(`[${callMetaData.callEvent} LCA EVENT]: [${callMetaData.callId}] - Uploaded ${sourceFile} to S3 complete: ${JSON.stringify(data)}`);
    } catch (err) {
        server.log.error(`[${callMetaData.callEvent} LCA EVENT]: [${callMetaData.callId}] - Error uploading ${sourceFile} to S3: ${normalizeErrorForLogging(err)}`);
    } finally {
        fileStream.destroy();
    }
    return data;
};

export const deleteTempFile = async(callMetaData: CallMetaData, sourceFile:string) => {
    try {
        await fs.promises.unlink(sourceFile);
        server.log.debug(`[${callMetaData.callEvent} LCA EVENT]: [${callMetaData.callId}] - Deleted tmp file ${sourceFile}`);
    } catch (err) {
        server.log.error(`[${callMetaData.callEvent} LCA EVENT]: [${callMetaData.callId}] - Error deleting tmp file ${sourceFile} : ${normalizeErrorForLogging(err)}`);
    }
};
