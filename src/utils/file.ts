import type { FileKind, OutputFormat } from '../types'

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'])

export const detectFileKind = (file: File): FileKind => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'heic'
  if (file.type === 'image/gif' || name.endsWith('.gif')) return 'gif'
  if (IMAGE_TYPES.has(file.type) || file.type.startsWith('image/')) return 'image'
  if (VIDEO_TYPES.has(file.type) || file.type.startsWith('video/')) return 'video'
  return 'unknown'
}

export const formatBytes = (size: number): string => {
  if (size === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const value = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / (1024 ** value)).toFixed(value > 1 ? 2 : 1)} ${units[value]}`
}

export const suggestImageFormat = (file: File): OutputFormat => {
  const isGraphicPng = file.type === 'image/png' && file.size < 10 * 1024 * 1024
  if (isGraphicPng) return 'png'
  if (file.size > 8 * 1024 * 1024) return 'avif'
  return 'webp'
}

export const isMobileBrowser = (): boolean => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export const maybeReplaceExt = (filename: string, ext: string): string => filename.replace(/\.[^/.]+$/, '') + ext
