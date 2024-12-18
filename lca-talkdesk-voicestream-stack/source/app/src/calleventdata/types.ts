// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import stream from 'stream';
import { WriteStream } from 'fs';

import { 
    TranscriptEvent,
    UtteranceEvent,
    CategoryEvent,
} from '@aws-sdk/client-transcribe-streaming';
// import BlockStream2 from 'block-stream2';

export type Uuid = string;             // UUID as defined by RFC#4122
export type SpeakerRole = 'AGENT' | 'CALLER' | 'UNKNOWN'; //speaker mapping trial
export type EventType = 
    | 'START' // required
    | 'ADD_TRANSCRIPT_SEGMENT' // required 
    | 'UPDATE_AGENT' // optional
    | 'ADD_S3_RECORDING_URL'  // optional
    | 'ADD_CALL_CATEGORY' // optional
    | 'END'; // required

export type CallEventBase<Type extends EventType = EventType> = {
    EventType: Type,
    CallId: Uuid,
    CreatedAt?: string,
    UpdatedAt?: string,
};

export type CallStartEvent = CallEventBase<'START'> & {
    CustomerPhoneNumber: string,
    SystemPhoneNumber: string,
    AgentId: string | undefined,
};

export type CallEndEvent = CallEventBase<'END'> & {
    CustomerPhoneNumber: string,
    SystemPhoneNumber: string
};

export type CallRecordingEvent = CallEventBase<'ADD_S3_RECORDING_URL'> & {
    RecordingUrl: string,
};

// Updated AddTranscriptSegmentEvent to include speaker diarization info
export type AddTranscriptSegmentEvent = CallEventBase<'ADD_TRANSCRIPT_SEGMENT'> & {
    Channel?: SpeakerRole,
    SegmentId?: string,
    StartTime?: number,
    EndTime?: number,
    Transcript?: string,
    IsPartial?: boolean,
    Sentiment?: string,
    SpeakerId?: string,  // Add speaker ID for diarization
    SpeakerConfidence?: number, // Add confidence score
    TranscriptEvent?: TranscriptEvent,
    UtteranceEvent?: UtteranceEvent,
};

// Added new type for speaker information
export type SpeakerProfile = {
    speakerId: string,
    role: 'AGENT' | 'CALLER',
    confidenceScore: number,
    totalSpeakingTime: number,
    utteranceCount: number
};


export type AddCallCategoryEvent = CallEventBase<'ADD_CALL_CATEGORY'> & {
    CategoryEvent: CategoryEvent,
};

// Updated CallMetaData to include diarization settings
export type CallMetaData = {
    callId: Uuid,
    fromNumber?: string,
    toNumber?: string,
    shouldRecordCall?: boolean,
    agentId?: string,
    samplingRate: number,
    callEvent: string,
    enableSpeakerDiarization?: boolean,
    maxSpeakers?: number,
    minSpeakerConfidence?: number
};

// Simplified SocketCallData for mono channel
export type SocketCallData = {
    callMetadata: CallMetaData,
    audioInputStream: stream.PassThrough,
    writeRecordingStream?: WriteStream,
    recordingFileSize: { filesize: number },
    startStreamTime: Date,
    // Remove dual channel specific properties
    // agentBlock: BlockStream2,
    // callerBlock: BlockStream2,
    // combinedStream: PassThrough,
    // combinedStreamBlock: BlockStream2,
    ended: boolean,
    speakerProfiles?: Map<string, SpeakerProfile> // Add speaker profiles
};

// Updated ExotelCallMetaData
export interface ExotelCallMetaData extends CallMetaData {
    customParameters?: {[key: string]: string};
    bitRate?: string;
    reason?: string;
    // Add any Exotel-specific diarization settings if needed
    exotelDiarizationConfig?: {
        enableCustomMapping?: boolean;
        speakerMapping?: Record<string, 'AGENT' | 'CALLER'>;
    };
}
  
// Updated ExotelSocketCallData
export interface ExotelSocketCallData extends SocketCallData {
    callMetadata: ExotelCallMetaData;
}

// Added new types for diarization results
export type DiarizedSegment = {
    speakerId: string;
    role: 'AGENT' | 'CALLER';
    transcript: string;
    startTime: number;
    endTime: number;
    confidence: number;
    isPartial: boolean;
};

// Added new type for audio stream configuration
export type AudioStreamConfig = {
    highWaterMark: number;
    chunkSize: number;
    samplingRate: number;
    bytesPerSample: number;
};

// Added new type for stream metrics
export type StreamMetrics = {
    bufferLevel: number;
    processedChunks: number;
    totalBytesProcessed: number;
    averageChunkSize: number;
    lastProcessingTime: Date;
};

//Trying mapping
export interface SpeakerMapping {
    callId: string;
    speakerRoleMap: Map<string, 'AGENT' | 'CALLER'>;
    firstSpeakerRole?: 'AGENT' | 'CALLER';
}