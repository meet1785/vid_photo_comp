import type { CompressionSettings, OutputFormat } from '../types'

export interface WorkerCompressRequest {
  type: 'compress'
  id: string
  file: File
  settings: CompressionSettings
}

export interface WorkerProgressMessage {
  type: 'progress'
  id: string
  progress: number
  note?: string
}

export interface WorkerResultMessage {
  type: 'result'
  id: string
  buffer: ArrayBuffer
  mimeType: string
  filename: string
  format: OutputFormat
}

export interface WorkerErrorMessage {
  type: 'error'
  id: string
  error: string
}

export type WorkerResponse = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage
