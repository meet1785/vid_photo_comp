import { useMemo, useState } from 'react'

interface Props {
  before: string
  after: string
}

export function ImageCompare({ before, after }: Props) {
  const [split, setSplit] = useState(50)
  const clip = useMemo(() => `inset(0 ${100 - split}% 0 0)`, [split])

  return (
    <div className="space-y-2">
      <div className="relative h-56 overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
        <img src={before} alt="Original" className="h-full w-full object-contain" />
        <img
          src={after}
          alt="Compressed"
          className="absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: clip }}
        />
      </div>
      <input
        type="range"
        min={1}
        max={99}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}
