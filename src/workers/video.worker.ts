/// <reference lib="webworker" />

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import type { WorkerCompressRequest, WorkerResponse } from './messages'
import { maybeReplaceExt } from '../utils/file'

const ffmpeg = new FFmpeg()
let isLoaded = false

const loadEngine = async () => {
  if (isLoaded) return
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
  })
  isLoaded = true
}

self.onmessage = async (event: MessageEvent<WorkerCompressRequest>) => {
  const msg = event.data
  if (msg.type !== 'compress') return
  const post = (data: WorkerResponse) => self.postMessage(data)

  const inputName = `in-${msg.id}-${msg.file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`
  const ext = msg.settings.outputFormat === 'webm' ? '.webm' : '.mp4'
  const outputName = maybeReplaceExt(inputName, ext)

  try {
    post({ type: 'progress', id: msg.id, progress: 0.02, note: 'Loading video engine...' })
    await loadEngine()

    const progressCb = ({ progress }: { progress: number }) => {
      post({ type: 'progress', id: msg.id, progress: Math.max(0.05, Math.min(0.99, progress)) })
    }

    ffmpeg.on('progress', progressCb)

    await ffmpeg.writeFile(inputName, await fetchFile(msg.file))

    const crf = String(msg.settings.videoCrfOverride ?? 24)
    const args = msg.settings.videoCodec === 'vp9'
      ? ['-i', inputName, '-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-c:a', 'libopus', outputName]
      : ['-i', inputName, '-c:v', 'libx264', '-crf', crf, '-preset', 'medium', '-movflags', '+faststart', '-c:a', 'aac', outputName]

    const exitCode = await ffmpeg.exec(args)
    if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`)

    const data = await ffmpeg.readFile(outputName)

    await ffmpeg.deleteFile(inputName)
    await ffmpeg.deleteFile(outputName)
    ffmpeg.off('progress', progressCb)

    const buffer = data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : typeof data === 'string'
        ? new TextEncoder().encode(data).buffer
        : data

    post({ type: 'progress', id: msg.id, progress: 1 })
    post({
      type: 'result',
      id: msg.id,
      buffer: buffer as ArrayBuffer,
      mimeType: msg.settings.outputFormat === 'webm' ? 'video/webm' : 'video/mp4',
      filename: maybeReplaceExt(msg.file.name, ext),
      format: msg.settings.outputFormat === 'webm' ? 'webm' : 'mp4',
    })
  } catch (error) {
    post({ type: 'error', id: msg.id, error: error instanceof Error ? error.message : 'Video compression failed' })
  }
}
