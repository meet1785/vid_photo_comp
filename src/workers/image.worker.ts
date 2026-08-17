/// <reference lib="webworker" />

import { heicTo } from 'heic-to'
import type { WorkerCompressRequest, WorkerResponse } from './messages'
import { maybeReplaceExt } from '../utils/file'

const asImageData = async (blob: Blob): Promise<ImageData> => {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to decode image')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

const outputMime = (format: string): string => {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'avif') return 'image/avif'
  if (format === 'png') return 'image/png'
  return 'image/webp'
}

self.onmessage = async (event: MessageEvent<WorkerCompressRequest>) => {
  const msg = event.data
  if (msg.type !== 'compress') return

  const post = (data: WorkerResponse) => self.postMessage(data)

  try {
    post({ type: 'progress', id: msg.id, progress: 0.05, note: 'Preparing image...' })

    const format = msg.settings.outputFormat === 'auto'
      ? msg.file.type === 'image/png' ? 'png' : 'webp'
      : msg.settings.outputFormat

    const sourceBlob = msg.file.name.toLowerCase().endsWith('.heic') || msg.file.name.toLowerCase().endsWith('.heif')
      ? await heicTo({ blob: msg.file, type: 'image/jpeg', quality: 1 })
      : msg.file

    post({ type: 'progress', id: msg.id, progress: 0.2 })
    let imageData = await asImageData(sourceBlob)

    if (msg.settings.resizeEnabled && msg.settings.maxDimension && Math.max(imageData.width, imageData.height) > msg.settings.maxDimension) {
      const resize = (await import('@jsquash/resize')).default
      const ratio = msg.settings.maxDimension / Math.max(imageData.width, imageData.height)
      imageData = await resize(imageData, {
        width: Math.max(1, Math.round(imageData.width * ratio)),
        height: Math.max(1, Math.round(imageData.height * ratio)),
      })
    }

    post({ type: 'progress', id: msg.id, progress: 0.45 })

    const quality = (msg.settings.imageQualityOverride ?? 78)
    let outputBuffer: ArrayBuffer

    if (format === 'png') {
      const { encode } = await import('@jsquash/png')
      const pngBuffer = await encode(imageData)
      const { optimise } = await import('@jsquash/oxipng')
      outputBuffer = await optimise(pngBuffer, { level: 2 })
    } else if (format === 'jpeg') {
      const { encode } = await import('@jsquash/jpeg')
      outputBuffer = await encode(imageData, { quality })
    } else if (format === 'avif') {
      const { encode } = await import('@jsquash/avif')
      outputBuffer = await encode(imageData, { quality, speed: 6 })
    } else {
      const { encode } = await import('@jsquash/webp')
      outputBuffer = await encode(imageData, { quality })
    }

    post({ type: 'progress', id: msg.id, progress: 1 })

    const ext = format === 'jpeg' ? '.jpg' : `.${format}`
    post({
      type: 'result',
      id: msg.id,
      buffer: outputBuffer,
      mimeType: outputMime(format),
      filename: maybeReplaceExt(msg.file.name, ext),
      format,
    })
  } catch (error) {
    post({ type: 'error', id: msg.id, error: error instanceof Error ? error.message : 'Image compression failed' })
  }
}
