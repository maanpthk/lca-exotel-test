// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import stream, { PassThrough } from 'stream';
import { WriteStream } from 'fs';

import { 
    TranscriptEvent,
    UtteranceEvent,
    CategoryEvent,
} from '@aws-sdk/client-transcribe-streaming';
import BlockStream2 from 'block-stream2';

export type Uuid = string;             // UUID as defined by RFC#4122

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

export type AddTranscriptSegmentEvent = CallEventBase<'ADD_TRANSCRIPT_SEGMENT'> & {
    Channel?: string,
    SegmentId?: string,
    StartTime?: number,
    EndTime?: number,
    Transcript?: string,
    IsPartial?: boolean,
    Sentiment?: string,
    TranscriptEvent?: TranscriptEvent,
    UtteranceEvent?: UtteranceEvent,
};

export type AddCallCategoryEvent = CallEventBase<'ADD_CALL_CATEGORY'> & {
    CategoryEvent: CategoryEvent,
};

export type CallMetaData = {
    callId: Uuid,
    fromNumber?: string,
    toNumber?: string,
    shouldRecordCall?: boolean,
    agentId?: string,
    samplingRate: number,
    callEvent: string,
};

export type SocketCallData = {
    callMetadata: CallMetaData,
    audioInputStream?: stream.PassThrough,
    writeRecordingStream?: WriteStream,
    recordingFileSize?: { filesize: number },
    startStreamTime: Date,
    agentBlock: BlockStream2,
    callerBlock: BlockStream2,
    combinedStream: PassThrough,
    combinedStreamBlock: BlockStream2,
    ended: boolean,
}
export interface ExotelCallMetaData extends CallMetaData {
    customParameters?: {[key: string]: string};
    bitRate?: string;
    reason?: string;
  }
  
  export interface ExotelSocketCallData extends SocketCallData {
    callMetadata: ExotelCallMetaData;
  }