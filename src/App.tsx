import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { ImageCompare } from './components/ImageCompare'
import type { CompressionSettings, OutputFormat, QueueItem } from './types'
import { PRESETS } from './types'
import { detectFileKind, formatBytes, isMobileBrowser, suggestImageFormat } from './utils/file'
import type { WorkerCompressRequest, WorkerResponse } from './workers/messages'

const defaultSettings: CompressionSettings = {
  preset: 'balanced',
  outputFormat: 'auto',
  advancedMode: false,
  resizeEnabled: false,
  stripMetadata: false,
  videoCodec: 'h264',
}

function App() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [settings, setSettings] = useState<CompressionSettings>(defaultSettings)
  const [isProcessing, setIsProcessing] = useState(false)
  const [workerNote, setWorkerNote] = useState('')
  const [warning, setWarning] = useState('')

  const imageWorkerRef = useRef<Worker | null>(null)
  const videoWorkerRef = useRef<Worker | null>(null)
  const runningRef = useRef(false)
  const queueRef = useRef<QueueItem[]>([])

  const effectiveQuality = settings.imageQualityOverride ?? PRESETS[settings.preset].imageQuality
  const effectiveCrf = settings.videoCrfOverride ?? PRESETS[settings.preset].videoCrf

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  const workerMessageHandler = useCallback((event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    if (data.type === 'progress') {
      setWorkerNote(data.note ?? '')
      setQueue((prev) => prev.map((item) => item.id === data.id ? { ...item, progress: data.progress, status: 'processing' } : item))
      return
    }

    if (data.type === 'error') {
      runningRef.current = false
      setQueue((prev) => prev.map((item) => item.id === data.id ? { ...item, status: 'error', error: data.error, progress: 0 } : item))
      return
    }

    const blob = new Blob([data.buffer], { type: data.mimeType })
    const preview = URL.createObjectURL(blob)

    runningRef.current = false
    setQueue((prev) => prev.map((item) => item.id === data.id ? {
      ...item,
      status: 'done',
      progress: 1,
      compressedPreviewUrl: preview,
      result: {
        blob,
        outputName: data.filename,
        outputType: data.mimeType,
      },
    } : item))
  }, [])

  const ensureWorkers = useCallback(() => {
    if (!imageWorkerRef.current) {
      imageWorkerRef.current = new Worker(new URL('./workers/image.worker.ts', import.meta.url), { type: 'module' })
      imageWorkerRef.current.addEventListener('message', workerMessageHandler)
    }

    if (!videoWorkerRef.current) {
      videoWorkerRef.current = new Worker(new URL('./workers/video.worker.ts', import.meta.url), { type: 'module' })
      videoWorkerRef.current.addEventListener('message', workerMessageHandler)
    }
  }, [workerMessageHandler])

  useEffect(() => {
    return () => {
      for (const item of queueRef.current) {
        URL.revokeObjectURL(item.originalPreviewUrl)
        if (item.compressedPreviewUrl) URL.revokeObjectURL(item.compressedPreviewUrl)
      }

      if (imageWorkerRef.current) {
        imageWorkerRef.current.removeEventListener('message', workerMessageHandler)
        imageWorkerRef.current.terminate()
      }
      if (videoWorkerRef.current) {
        videoWorkerRef.current.removeEventListener('message', workerMessageHandler)
        videoWorkerRef.current.terminate()
      }
    }
  }, [workerMessageHandler])

  const onFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return

    const incoming = Array.from(fileList).map((file): QueueItem => ({
      id: crypto.randomUUID(),
      file,
      kind: detectFileKind(file),
      status: 'queued',
      progress: 0,
      originalPreviewUrl: URL.createObjectURL(file),
    }))

    const hugeMobileVideo = incoming.some((item) => isMobileBrowser() && item.kind === 'video' && item.file.size > 200 * 1024 * 1024)
    if (hugeMobileVideo) {
      setWarning('Large mobile video detected (>200MB). Compression can be slow and may fail from memory pressure. Consider trimming or Max Compression.')
    }

    setQueue((prev) => [...prev, ...incoming])
  }

  const activeItems = useMemo(() => queue.filter((item) => item.status === 'queued'), [queue])

  useEffect(() => {
    if (!isProcessing || runningRef.current) return
    ensureWorkers()

    const next = queue.find((item) => item.status === 'queued' && item.kind !== 'unknown')
    if (!next) {
      setIsProcessing(false)
      return
    }

    runningRef.current = true
    setQueue((prev) => prev.map((item) => item.id === next.id ? { ...item, status: 'processing', progress: 0.01 } : item))

    const targetFormat = (() => {
      if (next.kind === 'video') return settings.outputFormat === 'webm' ? 'webm' : 'mp4'
      if (next.kind === 'gif' && next.file.size > 2 * 1024 * 1024) return 'mp4'
      return settings.outputFormat === 'auto' ? suggestImageFormat(next.file) : settings.outputFormat
    })() as OutputFormat

    const payload: WorkerCompressRequest = {
      type: 'compress',
      id: next.id,
      file: next.file,
      settings: {
        ...settings,
        outputFormat: targetFormat,
        imageQualityOverride: effectiveQuality,
        videoCrfOverride: effectiveCrf,
      },
    }

    if ((next.kind === 'video' || next.kind === 'gif') && videoWorkerRef.current) {
      videoWorkerRef.current.postMessage(payload)
      return
    }

    imageWorkerRef.current?.postMessage(payload)
  }, [effectiveCrf, effectiveQuality, ensureWorkers, isProcessing, queue, settings])

  const startCompression = () => {
    if (!activeItems.length) return
    setIsProcessing(true)
  }

  const downloadOne = (item: QueueItem) => {
    if (!item.result) return
    const url = URL.createObjectURL(item.result.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = item.result.outputName
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadZip = () => {
    const done = queue.filter((item) => item.result)
    if (!done.length) return

    Promise.all(done.map(async (item, index) => {
      const arr = new Uint8Array(await item.result!.blob.arrayBuffer())
      return [item.result!.outputName || `file-${index}`, arr] as const
    })).then((entries) => {
      const map: Record<string, Uint8Array> = Object.fromEntries(entries)
      map['README.txt'] = strToU8('Created locally in your browser. No uploads were performed.')
      const zipped = zipSync(map, { level: 6 })
      const blob = new Blob([zipped], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'compressed-files.zip'
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <header className="mb-6 space-y-3">
        <h1 className="text-3xl font-semibold">Free Photo & Video Compressor</h1>
        <p className="text-slate-300">100% client-side compression in your browser with no uploads.</p>
        <p className="text-xs text-amber-300">H.265 is not supported in ffmpeg.wasm here. Use H.264 or VP9 presets.</p>
      </header>

      <section className="mb-6 grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-4">
        <label className="text-sm">Preset
          <select className="mt-1 w-full rounded bg-slate-800 p-2" value={settings.preset} onChange={(e) => setSettings((s) => ({ ...s, preset: e.target.value as CompressionSettings['preset'], imageQualityOverride: undefined, videoCrfOverride: undefined }))}>
            <option value="best">Best Quality</option>
            <option value="balanced">Balanced</option>
            <option value="max">Max Compression</option>
          </select>
        </label>

        <label className="text-sm">Output Format
          <select className="mt-1 w-full rounded bg-slate-800 p-2" value={settings.outputFormat} onChange={(e) => setSettings((s) => ({ ...s, outputFormat: e.target.value as OutputFormat }))}>
            <option value="auto">Auto (smart suggestion)</option>
            <option value="webp">WebP (images)</option>
            <option value="avif">AVIF (images)</option>
            <option value="jpeg">JPEG (images)</option>
            <option value="png">PNG (lossless)</option>
            <option value="mp4">MP4 (videos)</option>
            <option value="webm">WebM (videos)</option>
          </select>
        </label>

        <label className="text-sm">Video Codec
          <select className="mt-1 w-full rounded bg-slate-800 p-2" value={settings.videoCodec} onChange={(e) => setSettings((s) => ({ ...s, videoCodec: e.target.value as CompressionSettings['videoCodec'] }))}>
            <option value="h264">H.264 (balanced)</option>
            <option value="vp9">VP9 (smaller, slower)</option>
          </select>
        </label>

        <button type="button" className="self-end rounded bg-cyan-500 px-4 py-2 font-medium text-slate-950" onClick={() => setSettings((s) => ({ ...s, advancedMode: !s.advancedMode }))}>
          {settings.advancedMode ? 'Hide advanced' : 'Show advanced'}
        </button>

        {settings.advancedMode && (
          <>
            <label className="text-sm md:col-span-2">Image Quality ({effectiveQuality})
              <input type="range" min={35} max={95} value={effectiveQuality} onChange={(e) => setSettings((s) => ({ ...s, imageQualityOverride: Number(e.target.value) }))} className="mt-2 w-full" />
            </label>
            <label className="text-sm md:col-span-2">Video CRF ({effectiveCrf})
              <input type="range" min={18} max={34} value={effectiveCrf} onChange={(e) => setSettings((s) => ({ ...s, videoCrfOverride: Number(e.target.value) }))} className="mt-2 w-full" />
            </label>
          </>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.resizeEnabled} onChange={(e) => setSettings((s) => ({ ...s, resizeEnabled: e.target.checked }))} />
          Enable downscale (opt-in)
        </label>

        <label className="text-sm">Max Dimension
          <input type="number" min={320} max={7680} disabled={!settings.resizeEnabled} value={settings.maxDimension ?? 1920} onChange={(e) => setSettings((s) => ({ ...s, maxDimension: Number(e.target.value) }))} className="mt-1 w-full rounded bg-slate-800 p-2 disabled:opacity-50" />
        </label>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={settings.stripMetadata} onChange={(e) => setSettings((s) => ({ ...s, stripMetadata: e.target.checked }))} />
          Strip metadata (orientation is preserved by pixel decode)
        </label>
      </section>

      <section className="mb-6 rounded-xl border border-dashed border-slate-700 p-4">
        <label
          className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded bg-slate-900/70 p-4 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            onFiles(e.dataTransfer.files)
          }}
        >
          <span className="font-medium">Drag & drop files/folders or click to select</span>
          <span className="text-xs text-slate-400">Images, HEIC, GIF, and videos are processed locally in workers.</span>
          <input type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </label>
        <div className="mt-3">
          <input type="file" multiple {...({ webkitdirectory: 'true' } as Record<string, string>)} className="text-sm" onChange={(e) => onFiles(e.target.files)} />
        </div>
      </section>

      {warning && <p className="mb-4 rounded border border-amber-700 bg-amber-900/30 p-3 text-sm text-amber-200">{warning}</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="rounded bg-cyan-500 px-4 py-2 font-medium text-slate-950 disabled:opacity-50" disabled={!activeItems.length || isProcessing} onClick={startCompression}>Compress queued files</button>
        <button type="button" className="rounded bg-slate-700 px-4 py-2 disabled:opacity-50" disabled={!queue.some((item) => item.result)} onClick={downloadZip}>Download all (ZIP)</button>
      </div>

      {isProcessing && <p className="mb-4 text-sm text-cyan-300">Processing in worker… {workerNote}</p>}

      <section className="grid gap-4 md:grid-cols-2">
        {queue.map((item) => {
          const ratio = item.result ? Math.round((1 - (item.result.blob.size / item.file.size)) * 100) : null
          return (
            <article key={item.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="truncate font-medium">{item.file.name}</p>
                  <p className="text-xs text-slate-400">{item.kind.toUpperCase()} • {formatBytes(item.file.size)}</p>
                </div>
                <span className="rounded bg-slate-800 px-2 py-1 text-xs">{item.status}</span>
              </div>

              <div className="h-2 overflow-hidden rounded bg-slate-800">
                <div className="h-full bg-cyan-500" style={{ width: `${Math.round(item.progress * 100)}%` }} />
              </div>

              {item.kind === 'video' || item.kind === 'gif' ? (
                <div className="space-y-2">
                  <video src={item.originalPreviewUrl} controls className="w-full rounded" />
                  <p className="text-xs text-slate-400">Estimated size before export: ~{formatBytes(Math.max(1024, Math.round(item.file.size * (effectiveCrf / 40))))}</p>
                  {item.compressedPreviewUrl && <video src={item.compressedPreviewUrl} controls className="w-full rounded" />}
                </div>
              ) : item.compressedPreviewUrl ? (
                <ImageCompare before={item.originalPreviewUrl} after={item.compressedPreviewUrl} />
              ) : (
                <img src={item.originalPreviewUrl} alt="Original preview" className="h-56 w-full rounded object-contain" />
              )}

              {item.result && (
                <div className="flex items-center justify-between text-sm">
                  <p>{formatBytes(item.result.blob.size)} {ratio !== null ? `(${ratio}% smaller)` : ''}</p>
                  <button type="button" className="rounded bg-slate-700 px-3 py-1" onClick={() => downloadOne(item)}>Download</button>
                </div>
              )}

              {item.error && <p className="text-sm text-red-300">{item.error}</p>}
            </article>
          )
        })}
      </section>
    </main>
  )
}

export default App
