export interface NoteSegment {
  id: string;
  timestamp: string;
  transcript: string;
  notes: string[];
  status: 'processing' | 'completed' | 'error';
  confidence?: number; // 0.0 to 1.0
}

export interface ProcessingResult {
  transcript: string;
  notes: string[];
}

export enum RecorderStatus {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR'
}

export type AudioSource = 'microphone' | 'system';