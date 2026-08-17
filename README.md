# Free Photo & Video Compressor

A 100% browser-based compressor for images and videos.

## Highlights

- Client-side only processing (no uploads)
- React 18 + TypeScript + Vite + Tailwind
- PWA with offline support after first load
- Worker-based compression to keep UI responsive
- Image codecs via jSquash (`jpeg`, `webp`, `avif`, `oxipng`, optional resize)
- HEIC/HEIF intake via `heic-to`
- Video compression via `ffmpeg.wasm` with CRF presets (H.264 / VP9)
- Batch download as ZIP via `fflate`

## Presets

- **Best Quality**: high quality image/video settings
- **Balanced**: default quality/size tradeoff
- **Max Compression**: strongest compression

Advanced controls allow manual image quality and video CRF override.

## Notes

- H.265/HEVC encoding is not supported in this ffmpeg.wasm build.
- Large video compression (especially on mobile) can be slow and memory-intensive.
- Compression preserves visual orientation; metadata stripping is exposed separately.

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
```
