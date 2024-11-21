// // Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// // SPDX-License-Identifier: Apache-2.0

export type Uuid = string;  
export type StartEvent = 'start';
export type StopEvent = 'stop';
export type MediaEvent = 'media';
export type ConnectedEvent = 'connected';

export const isConnectedEvent = (value: string): value is MediaStreamEventType => (
    (value === 'connected')
);

export const isStartEvent = (value: MediaStreamEventType): value is MediaStreamEventType => (
    (value === 'start')
);

export const isStopEvent = (value: MediaStreamEventType): value is MediaStreamEventType => (
    (value === 'stop')
);

export const isMediaEvent = (value: MediaStreamEventType): value is MediaStreamEventType => (
    (value === 'media')
);
export interface ExotelMediaFormat {
    encoding: string;
    sample_rate: string;
    bit_rate: string;
  }
  
  export interface ExotelCustomParameters {
    [key: string]: string;
  }
  
  export interface ExotelStartMessage extends MediaStreamBase<StartEvent> {
    sequence_number: number;
    start: {
      stream_sid: string;
      call_sid: string;
      account_sid: string;
      from: string;
      to: string;
      custom_parameters: ExotelCustomParameters;
      media_format: ExotelMediaFormat;
    }
  }
  
  export interface ExotelMediaMessage extends MediaStreamBase<MediaEvent> {
    sequence_number: number;
    media: {
      chunk: number;
      timestamp: string;
      payload: string;
    }
  }
  
  export interface ExotelStopMessage extends MediaStreamBase<StopEvent> {
    sequence_number: number; 
    stop: {
      call_sid: string;
      account_sid: string;
      reason: string;
    }
  }
export type MediaStreamEventType = 
    | StartEvent 
    | StopEvent 
    | MediaEvent
    | ConnectedEvent;

export type MediaStreamConnectedMessage = {
    event: ConnectedEvent;
    protocol: string;
    version: string;
}

export type MediaStreamBase<Type extends MediaStreamEventType = MediaStreamEventType> = {
    event: Type;
    sequenceNumber: string;
    streamSid: Uuid;
}

export type MediaStreamStartMessage = MediaStreamBase<StartEvent> & {
    start: {
        accountSid: Uuid;
        streamSid: Uuid;
        callSid: Uuid;
        tracks: string[];
        mediaFormat: {
            encoding: string;
            sampleRate: number;
            channels: number
        };
    }
}

export type MediaStreamMediaMessage = MediaStreamBase<MediaEvent> & {
    media: {
        track: string;
        chunk: string;  
        timestamp: Uuid;
        payload: string;
    }
}

export type MediaStreamStopMessage = MediaStreamBase<StopEvent> & {
    stop: {
        accountSid: Uuid;
        callSid: Uuid;  
    }
}

export type MediaStreamMessage = 
    | MediaStreamConnectedMessage 
    | MediaStreamStartMessage 
    | MediaStreamMediaMessage 
    | MediaStreamStopMessage;