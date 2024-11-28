// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//indent issues solved again
import { 
    TranscriptEvent, 
    UtteranceEvent,
    CategoryEvent,
    TranscribeStreamingClient, 
    StartStreamTranscriptionCommand, 
    TranscriptResultStream,
    StartCallAnalyticsStreamTranscriptionCommand,
    StartCallAnalyticsStreamTranscriptionCommandInput,
    CallAnalyticsTranscriptResultStream,
    ConfigurationEvent,
    ParticipantRole,
    ChannelDefinition,
    StartStreamTranscriptionCommandInput,
    ContentRedactionOutput,
    LanguageCode,
} from '@aws-sdk/client-transcribe-streaming';

// import { MediaEncoding } from '@aws-sdk/client-transcribe-streaming';
import { 
    KinesisClient, 
    PutRecordCommand 
} from '@aws-sdk/client-kinesis';

import { 
    CallMetaData,
    ExotelCallMetaData,
    ExotelSocketCallData,
    CallStartEvent,
    CallEndEvent,
    CallRecordingEvent,
    AddTranscriptSegmentEvent,
    AddCallCategoryEvent,
    Uuid,
    SpeakerRole
} from './types';
import {
    normalizeErrorForLogging
} from '../utils';

import stream from 'stream';
import { FastifyInstance } from 'fastify';

const formatPath = function(path:string) {
    let pathOut = path;
    if (path.length > 0 && path.charAt(path.length - 1) != '/') {
        pathOut += '/';
    }
    return pathOut;
};

import dotenv from 'dotenv';
dotenv.config();

const AWS_REGION = process.env['AWS_REGION'] || 'us-east-1';
const TRANSCRIBE_API_MODE = process.env['TRANSCRIBE_API_MODE'] || 'standard';
const isTCAEnabled = TRANSCRIBE_API_MODE === 'analytics';
const TRANSCRIBE_LANGUAGE_CODE = process.env['TRANSCRIBE_LANGUAGE_CODE'] || 'en-US';
const TRANSCRIBE_LANGUAGE_OPTIONS = process.env['TRANSCRIBE_LANGUAGE_OPTIONS'] || undefined;
const TRANSCRIBE_PREFERRED_LANGUAGE = process.env['TRANSCRIBE_PREFERRED_LANGUAGE'] || 'None';
const CUSTOM_VOCABULARY_NAME = process.env['CUSTOM_VOCABULARY_NAME'] || undefined;
const CUSTOM_LANGUAGE_MODEL_NAME = process.env['CUSTOM_LANGUAGE_MODEL_NAME'] || undefined;
const IS_CONTENT_REDACTION_ENABLED = (process.env['IS_CONTENT_REDACTION_ENABLED'] || '') === 'true';
const CONTENT_REDACTION_TYPE = process.env['CONTENT_REDACTION_TYPE'] || 'PII';
const TRANSCRIBE_PII_ENTITY_TYPES = process.env['TRANSCRIBE_PII_ENTITY_TYPES'] || undefined;
const TCA_DATA_ACCESS_ROLE_ARN = process.env['TCA_DATA_ACCESS_ROLE_ARN'] || '';
const CALL_ANALYTICS_FILE_PREFIX = formatPath(process.env['CALL_ANALYTICS_FILE_PREFIX'] || 'lca-call-analytics-json/');
const RECORDINGS_BUCKET_NAME = process.env['RECORDINGS_BUCKET_NAME'] || null;
// optional - disable post call analytics output
const IS_TCA_POST_CALL_ANALYTICS_ENABLED = (process.env['IS_TCA_POST_CALL_ANALYTICS_ENABLED'] || 'false') === 'true';
// optional - when redaction is enabled, choose 'redacted' only (dafault), or 'redacted_and_unredacted' for both
const POST_CALL_CONTENT_REDACTION_OUTPUT = process.env['POST_CALL_CONTENT_REDACTION_OUTPUT'] || 'redacted';
// Add new environment variable for diarization
const ENABLE_SPEAKER_DIARIZATION = (process.env['ENABLE_SPEAKER_DIARIZATION'] || 'true') === 'true';
// const MAX_SPEAKERS = parseInt(process.env['MAX_SPEAKERS'] || '2', 10);
// const MIN_SPEAKER_CONFIDENCE = parseFloat(process.env['MIN_SPEAKER_CONFIDENCE'] || '0.5');

const savePartial = (process.env['SAVE_PARTIAL_TRANSCRIPTS'] || 'true') === 'true';
const kdsStreamName = process.env['KINESIS_STREAM_NAME'] || '';

const tcaOutputLocation = `s3://${RECORDINGS_BUCKET_NAME}/${CALL_ANALYTICS_FILE_PREFIX}`;

type transcriptionCommandInput<TCAEnabled> = TCAEnabled extends true 
    ? StartCallAnalyticsStreamTranscriptionCommandInput
    : StartStreamTranscriptionCommandInput;
  


const kinesisClient = new KinesisClient({ region: AWS_REGION });
const transcribeClient = new TranscribeStreamingClient({ region: AWS_REGION });
const AGENT_GREETING_PATTERNS = [
    /thank you for calling/i,
    /how may I help/i,
    /how can I help/i,
    /how can I assist/i,
    /this is .* speaking/i,
    /welcome to/i,
    /good (morning|afternoon|evening)/i,
    /thanks for calling/i,
];
export const writeCallEvent = async (callEvent: CallStartEvent | CallEndEvent | CallRecordingEvent, server: FastifyInstance) => {
    
    const putParams = {
        StreamName: kdsStreamName,
        PartitionKey: callEvent.CallId,
        Data: Buffer.from(JSON.stringify(callEvent))
    };

    const putCmd = new PutRecordCommand(putParams);
    try {
        await kinesisClient.send(putCmd);
        server.log.debug(`[${callEvent.EventType} LCA EVENT]: ${callEvent.CallId} - Written Call ${callEvent.EventType} Event to KDS: ${JSON.stringify(callEvent)}`);
    } catch (error) {
        server.log.debug(`[${callEvent.EventType}]: ${callEvent.CallId} - Error writing ${callEvent.EventType} Call Event to KDS : ${normalizeErrorForLogging(error)} Event: ${JSON.stringify(callEvent)}`);
    }
};

export const writeCallStartEvent = async (callMetaData: CallMetaData, server: FastifyInstance): Promise<void> => {
    const callStartEvent: CallStartEvent = {
        EventType: 'START',
        CallId: callMetaData.callId,
        CustomerPhoneNumber: callMetaData.fromNumber || 'Customer Phone',
        SystemPhoneNumber: callMetaData.toNumber || 'System Phone',
        AgentId: callMetaData.agentId,
        CreatedAt: new Date().toISOString()
    };
    await writeCallEvent(callStartEvent, server);  
};

export const writeCallEndEvent = async (callMetaData: CallMetaData, server: FastifyInstance): Promise<void> => {
    const callEndEvent: CallEndEvent = {
        EventType: 'END',
        CallId: callMetaData.callId,
        CustomerPhoneNumber: callMetaData.fromNumber || 'Customer Phone',
        SystemPhoneNumber: callMetaData.toNumber || 'System Phone',
    };
    await writeCallEvent(callEndEvent, server);  
};

export const writeCallRecordingEvent = async (callMetaData: CallMetaData, recordingUrl: string, server: FastifyInstance): Promise<void> => {
    const callRecordingEvent: CallRecordingEvent = {
        EventType: 'ADD_S3_RECORDING_URL',
        CallId: callMetaData.callId,
        RecordingUrl: recordingUrl
    };
    await writeCallEvent(callRecordingEvent, server);  
};

export const startTranscribe = async (callMetaData: ExotelCallMetaData, audioInputStream: stream.PassThrough, socketCallMap: ExotelSocketCallData, server: FastifyInstance) => {
    
    const transcribeInput = async function* () {
        if (isTCAEnabled) {
            // For Call Analytics, use single channel configuration
            const channel0: ChannelDefinition = { 
                ChannelId: 0, 
                ParticipantRole: ParticipantRole.CUSTOMER
            };
            
            const configuration_event: ConfigurationEvent = { 
                ChannelDefinitions: [channel0] // Single channel
            };

            if (IS_TCA_POST_CALL_ANALYTICS_ENABLED) {
                configuration_event.PostCallAnalyticsSettings = {
                    OutputLocation: tcaOutputLocation,
                    DataAccessRoleArn: TCA_DATA_ACCESS_ROLE_ARN
                };
                if (IS_CONTENT_REDACTION_ENABLED) {
                    configuration_event.PostCallAnalyticsSettings.ContentRedactionOutput = 
                        POST_CALL_CONTENT_REDACTION_OUTPUT as ContentRedactionOutput;
                }
            }
            yield { ConfigurationEvent: configuration_event };
        }

        for await (const chunk of audioInputStream) {
            server.log.debug(`[TRANSCRIBING]: [${callMetaData.callId}] Processing audio chunk of size: ${chunk.length}`);
            yield { AudioEvent: { AudioChunk: chunk } };
        }
    };
    
    let tsStream: stream.Readable | undefined;
    let outputCallAnalyticsStream: AsyncIterable<CallAnalyticsTranscriptResultStream> | undefined;
    let outputTranscriptStream: AsyncIterable<TranscriptResultStream> | undefined;

    // Configure transcribe parameters for mono audio with diarization
    const tsParams: transcriptionCommandInput<typeof isTCAEnabled> = {
        MediaSampleRateHertz: callMetaData.samplingRate || 8000,
        MediaEncoding: 'pcm',
        AudioStream: transcribeInput(),
        LanguageCode: TRANSCRIBE_LANGUAGE_CODE as LanguageCode,
        ShowSpeakerLabel: ENABLE_SPEAKER_DIARIZATION
    };


    if (TRANSCRIBE_LANGUAGE_CODE === 'identify-language') {
        (tsParams as StartStreamTranscriptionCommandInput).IdentifyLanguage = true;
        if (TRANSCRIBE_LANGUAGE_OPTIONS) {
            (tsParams as StartStreamTranscriptionCommandInput).LanguageOptions = TRANSCRIBE_LANGUAGE_OPTIONS.replace(/\s/g, '');
            if (TRANSCRIBE_PREFERRED_LANGUAGE !== 'None') {
                (tsParams as StartStreamTranscriptionCommandInput).PreferredLanguage = TRANSCRIBE_PREFERRED_LANGUAGE as LanguageCode;
            }
        }
    } else if (TRANSCRIBE_LANGUAGE_CODE === 'identify-multiple-languages') {
        (tsParams as StartStreamTranscriptionCommandInput).IdentifyMultipleLanguages = true;
        if (TRANSCRIBE_LANGUAGE_OPTIONS) {
            (tsParams as StartStreamTranscriptionCommandInput).LanguageOptions = TRANSCRIBE_LANGUAGE_OPTIONS.replace(/\s/g, '');
            if (TRANSCRIBE_PREFERRED_LANGUAGE !== 'None') {
                (tsParams as StartStreamTranscriptionCommandInput).PreferredLanguage = TRANSCRIBE_PREFERRED_LANGUAGE as LanguageCode;
            }
        }
    } else {
        tsParams.LanguageCode = TRANSCRIBE_LANGUAGE_CODE as LanguageCode;
    }

    if (IS_CONTENT_REDACTION_ENABLED && (
        TRANSCRIBE_LANGUAGE_CODE === 'en-US' ||
        TRANSCRIBE_LANGUAGE_CODE === 'en-AU' ||
        TRANSCRIBE_LANGUAGE_CODE === 'en-GB' ||
        TRANSCRIBE_LANGUAGE_CODE === 'es-US')) {
        tsParams.ContentRedactionType = CONTENT_REDACTION_TYPE as 'PII' | undefined;
        if (TRANSCRIBE_PII_ENTITY_TYPES) {
            tsParams.PiiEntityTypes = TRANSCRIBE_PII_ENTITY_TYPES;
        }
    }
    if (CUSTOM_VOCABULARY_NAME) {
        tsParams.VocabularyName = CUSTOM_VOCABULARY_NAME;
    }
    if (CUSTOM_LANGUAGE_MODEL_NAME) {
        tsParams.LanguageModelName = CUSTOM_LANGUAGE_MODEL_NAME;
    }

    if (isTCAEnabled) {
        try {
            const response = await transcribeClient.send(
                new StartCallAnalyticsStreamTranscriptionCommand(tsParams as StartCallAnalyticsStreamTranscriptionCommandInput)
            );
            server.log.debug(`[TRANSCRIBING]: [${callMetaData.callId}] === Received Initial response from TCA. Session Id: ${response.SessionId} ===`);

            outputCallAnalyticsStream = response.CallAnalyticsTranscriptResultStream;
        } catch (err) {
            server.log.error(`[TRANSCRIBING]: [${callMetaData.callId}] - Error in StartCallAnalyticsStreamTranscriptionCommand: ${normalizeErrorForLogging(err)}`);
            return;
        }
    } else {
        try {
            const response = await transcribeClient.send(
                new StartStreamTranscriptionCommand(tsParams as StartStreamTranscriptionCommandInput)
            );
            server.log.debug(`[TRANSCRIBING]: [${callMetaData.callId}] === Received Initial response from Transcribe. Session Id: ${response.SessionId} ===`);
            outputTranscriptStream = response.TranscriptResultStream;
        } catch (err) {
            server.log.error(`[TRANSCRIBING]: [${callMetaData.callId}] - Error in StartStreamTranscription: ${normalizeErrorForLogging(err)}`);
            return;            
        }
    }
    
    socketCallMap.startStreamTime = new Date();

    try {
        if (outputCallAnalyticsStream) {
            tsStream = stream.Readable.from(outputCallAnalyticsStream);
        } else if (outputTranscriptStream) {
            tsStream = stream.Readable.from(outputTranscriptStream);
        }

        if (tsStream) {
            for await (const event of tsStream) {
                server.log.debug(`[TRANSCRIBING]: [${callMetaData.callId}] Received transcription event`);
                
                if (event.TranscriptEvent) {
                    const message: TranscriptEvent = event.TranscriptEvent;
                    await processDiarizedTranscript(message, callMetaData.callId, server);
                }
                if (event.CategoryEvent && event.CategoryEvent.MatchedCategories) {
                    await writeAddCallCategoryEvent(event.CategoryEvent, callMetaData.callId, server);
                }
                if (event.UtteranceEvent && event.UtteranceEvent.UtteranceId) {
                    await writeAddTranscriptSegmentEvent(event.UtteranceEvent, undefined, callMetaData.callId, server);
                }
            }
        } else {
            server.log.error(`[TRANSCRIBING]: [${callMetaData.callId}] - Transcribe stream is empty`);
        }
    } catch (error) {
        server.log.error(`[TRANSCRIBING]: [${callMetaData.callId}] - Error processing Transcribe results stream ${normalizeErrorForLogging(error)}`);
    }
};

const detectSpeakerRoles = (transcript: string): SpeakerRole => {
    const matchedPattern = AGENT_GREETING_PATTERNS.find(pattern => pattern.test(transcript));
    const role = matchedPattern ? 'AGENT' : 'CALLER';
    
    console.log(`[ROLE DETECTION] Transcript: "${transcript}"`);
    console.log(`[ROLE DETECTION] Matched pattern: ${matchedPattern ? matchedPattern.toString() : 'none'}`);
    console.log(`[ROLE DETECTION] Assigned role: ${role}`);
    
    return role;
};

// New function to process diarized transcripts

const processDiarizedTranscript = async (event: TranscriptEvent, callId: string, server: FastifyInstance) => {
    server.log.debug(`[DIARIZATION]: [${callId}] Processing new transcript event`);

    if (!event.Transcript?.Results?.[0]) {
        server.log.debug(`[DIARIZATION]: [${callId}] No results in transcript event`);
        return;
    }
    
    const result = event.Transcript.Results[0];
    if (result.IsPartial === true && !savePartial) {
        server.log.debug(`[DIARIZATION]: [${callId}] Skipping partial result`);
        return;
    }

    // Static map to maintain speaker roles across function calls
    static const speakerRoleMap = new Map<string, SpeakerRole>();
    
    if (!result.Alternatives?.[0]?.Items) {
        server.log.debug(`[DIARIZATION]: [${callId}] No items in transcript alternatives`);
        return;
    }

    // Initialize speaker roles if not already set
    if (speakerRoleMap.size === 0) {
        const firstSegmentItems = result.Alternatives[0].Items.filter(item => item.Speaker === '0');
        const firstSegmentTranscript = firstSegmentItems.map(item => item.Content).join(' ');
        
        const isFirstSpeakerAgent = AGENT_GREETING_PATTERNS.some(pattern => pattern.test(firstSegmentTranscript));
        
        speakerRoleMap.set('0', isFirstSpeakerAgent ? 'AGENT' : 'CALLER');
        speakerRoleMap.set('1', isFirstSpeakerAgent ? 'CALLER' : 'AGENT');
        
        server.log.info(`[DIARIZATION]: [${callId}] Initial speaker role mapping set - Speaker 0: ${speakerRoleMap.get('0')}, Speaker 1: ${speakerRoleMap.get('1')}`);
    }

    // Collect all segments first
    const segments: Array<{
        speaker: string,
        transcript: string,
        startTime: number,
        endTime: number
    }> = [];
    
    let currentSpeaker = '';
    let currentTranscript = '';
    let startTime = result.StartTime;
    
    // Process all items and collect segments
    for (const item of result.Alternatives[0].Items) {
        if (item.Speaker && item.Speaker !== currentSpeaker) {
            // Add previous segment if exists
            if (currentTranscript) {
                segments.push({
                    speaker: currentSpeaker,
                    transcript: currentTranscript.trim(),
                    startTime: startTime,
                    endTime: Number(item.StartTime)
                });
            }
            
            currentSpeaker = item.Speaker;
            currentTranscript = item.Content || '';
            startTime = Number(item.StartTime);
        } else {
            currentTranscript += ' ' + (item.Content || '');
        }
    }
    
    // Add final segment
    if (currentTranscript && currentSpeaker) {
        segments.push({
            speaker: currentSpeaker,
            transcript: currentTranscript.trim(),
            startTime: startTime,
            endTime: result.EndTime || 0
        });
    }

    // Write all segments to KDS
    for (const segment of segments) {
        const speakerRole = speakerRoleMap.get(segment.speaker) || 'UNKNOWN';
        
        await writeTranscriptionSegment({
            Transcript: {
                Results: [{
                    StartTime: segment.startTime,
                    EndTime: segment.endTime,
                    IsPartial: result.IsPartial,
                    Alternatives: [{
                        Transcript: segment.transcript,
                        Items: []
                    }]
                }]
            }
        }, callId, server, segment.speaker, speakerRole);
    }

    server.log.debug(`[DIARIZATION]: [${callId}] Processed ${segments.length} segments`);
};



// Helper function to map speaker IDs to channels
// const mapSpeakerToChannel = (speakerId: string): 'AGENT' | 'CALLER' => {
//     return speakerId === 'spk_0' ? 'AGENT' : 'CALLER';
// };

export const writeTranscriptionSegment = async function(
    transcribeMessageJson: TranscriptEvent, 
    callId: Uuid, 
    server: FastifyInstance,
    speakerId?: string,
    speakerRole?: SpeakerRole
) {
    if (transcribeMessageJson.Transcript?.Results && transcribeMessageJson.Transcript?.Results.length > 0) {
        if (transcribeMessageJson.Transcript?.Results[0].Alternatives && transcribeMessageJson.Transcript?.Results[0].Alternatives?.length > 0) {
            const result = transcribeMessageJson.Transcript?.Results[0];

            if (result.IsPartial == undefined || (result.IsPartial == true && !savePartial)) {
                return;
            }
            const { Transcript: transcript } = transcribeMessageJson.Transcript.Results[0].Alternatives[0];
            const now = new Date().toISOString();

            const kdsObject: AddTranscriptSegmentEvent = {
                EventType: 'ADD_TRANSCRIPT_SEGMENT',
                CallId: callId,
                Channel: speakerRole || 'UNKNOWN',
                SpeakerId: speakerId,
                SegmentId: result.ResultId || '',
                StartTime: result.StartTime || 0,
                EndTime: result.EndTime || 0,
                Transcript: transcript || '',
                IsPartial: result.IsPartial,
                CreatedAt: now,
                UpdatedAt: now,
                Sentiment: undefined,
                TranscriptEvent: undefined,
                UtteranceEvent: undefined,
            };

            const putParams = {
                StreamName: kdsStreamName,
                PartitionKey: callId,
                Data: Buffer.from(JSON.stringify(kdsObject)),
            };

            const putCmd = new PutRecordCommand(putParams);
            try {
                await kinesisClient.send(putCmd);
                server.log.debug(`[${kdsObject.EventType}]: [${callId}] - Written ${kdsObject.EventType} event to KDS: ${JSON.stringify(kdsObject)}`);
            } catch (error) {
                server.log.error(`[${kdsObject.EventType}]: [${callId}] - Error writing ${kdsObject.EventType} to KDS : ${normalizeErrorForLogging(error)} KDS object: ${JSON.stringify(kdsObject)}`);
            }
        } 
    } 
};

export const writeAddTranscriptSegmentEvent = async function(
    utteranceEvent: UtteranceEvent | undefined, 
    transcriptEvent: TranscriptEvent | undefined,  
    callId: Uuid, 
    server: FastifyInstance
) {
    
    if (transcriptEvent) {
        if (transcriptEvent.Transcript?.Results && transcriptEvent.Transcript?.Results.length > 0) {
            if (transcriptEvent.Transcript?.Results[0].Alternatives && transcriptEvent.Transcript?.Results[0].Alternatives?.length > 0) {
                const result = transcriptEvent.Transcript?.Results[0];
                if (result.IsPartial == undefined || (result.IsPartial == true && !savePartial)) {
                    return;
                }
            }
        }
    }
                
    if (utteranceEvent) {
        if (utteranceEvent.IsPartial == undefined || (utteranceEvent.IsPartial == true && !savePartial)) {
            return;
        }

        // Add these lines to get channel and speaker information from utteranceEvent
        // const channel = utteranceEvent.ParticipantRole === 'AGENT' ? 'AGENT' : 'CALLER';
        // const speakerId = `spk_${utteranceEvent.ParticipantRole === 'AGENT' ? '0' : '1'}`;
    }
   
    const now = new Date().toISOString();
    // Convert ParticipantRole to SpeakerRole
    const mapParticipantRoleToSpeakerRole = (role?: ParticipantRole): SpeakerRole => {
        if (role === 'AGENT') {
            return 'AGENT';
        }
        if (role === 'CUSTOMER') {
            return 'CALLER';
        }
        
        return 'UNKNOWN';
    };
    const kdsObject: AddTranscriptSegmentEvent = {
        EventType: 'ADD_TRANSCRIPT_SEGMENT',
        CallId: callId,
        Channel: mapParticipantRoleToSpeakerRole(utteranceEvent?.ParticipantRole),
        SpeakerId: utteranceEvent ? `spk_${utteranceEvent.ParticipantRole === 'AGENT' ? '0' : '1'}` : '',
        SegmentId: utteranceEvent?.UtteranceId || '',
        TranscriptEvent: transcriptEvent,
        UtteranceEvent: utteranceEvent,
        CreatedAt: now,
        UpdatedAt: now,
    };

    const putParams = {
        StreamName: kdsStreamName,
        PartitionKey: callId,
        Data: Buffer.from(JSON.stringify(kdsObject)),
    };

    const putCmd = new PutRecordCommand(putParams);
    try {
        await kinesisClient.send(putCmd);
        server.log.debug(`[${kdsObject.EventType}]: [${callId}] - Written ${kdsObject.EventType} event to KDS: ${JSON.stringify(kdsObject)}`);
    } catch (error) {
        server.log.error(`[${kdsObject.EventType}]: [${callId}] - Error writing ${kdsObject.EventType} to KDS : ${normalizeErrorForLogging(error)} KDS object: ${JSON.stringify(kdsObject)}`);
    }
};

export const writeAddCallCategoryEvent = async function(categoryEvent:CategoryEvent, callId: Uuid, server: FastifyInstance) {

    if (categoryEvent) {
        const now = new Date().toISOString();
    
        const kdsObject:AddCallCategoryEvent = {
            EventType: 'ADD_CALL_CATEGORY',
            CallId: callId,
            CategoryEvent: categoryEvent,
            CreatedAt: now,
        };

        const putParams = {
            StreamName: kdsStreamName,
            PartitionKey: callId,
            Data: Buffer.from(JSON.stringify(kdsObject)),
        };

        const putCmd = new PutRecordCommand(putParams);
        try {
            await kinesisClient.send(putCmd);
            server.log.debug(`[${kdsObject.EventType}]: [${callId}] - Written ${kdsObject.EventType} event to KDS: ${JSON.stringify(kdsObject)}`);
            
        } catch (error) {
            server.log.error(`[${kdsObject.EventType}]: [${callId}] - Error writing ${kdsObject.EventType} to KDS : ${normalizeErrorForLogging(error)} KDS object: ${JSON.stringify(kdsObject)}`);
        }

    }
};