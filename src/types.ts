export type PresetKey = 'best' | 'balanced' | 'max'
export type OutputFormat = 'auto' | 'jpeg' | 'webp' | 'avif' | 'png' | 'mp4' | 'webm'

export type FileKind = 'image' | 'video' | 'gif' | 'heic' | 'unknown'

export interface CompressionPreset {
  imageQuality: number
  videoCrf: number
}

export const PRESETS: Record<PresetKey, CompressionPreset> = {
  best: { imageQuality: 90, videoCrf: 20 },
  balanced: { imageQuality: 78, videoCrf: 24 },
  max: { imageQuality: 56, videoCrf: 32 },
}

export interface CompressionSettings {
  preset: PresetKey
  outputFormat: OutputFormat
  advancedMode: boolean
  imageQualityOverride?: number
  videoCrfOverride?: number
  resizeEnabled: boolean
  maxDimension?: number
  stripMetadata: boolean
  videoCodec: 'h264' | 'vp9'
}

export interface CompressedResult {
  blob: Blob
  outputName: string
  outputType: string
}

export interface QueueItem {
  id: string
  file: File
  kind: FileKind
  status: 'queued' | 'processing' | 'done' | 'error'
  progress: number
  originalPreviewUrl: string
  compressedPreviewUrl?: string
  result?: CompressedResult
  error?: string
}
