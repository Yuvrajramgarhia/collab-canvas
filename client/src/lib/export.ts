import Konva from 'konva'
import type { Shape, View } from '../types'
import { newId } from './doc'

const PAD = 24
const MAX_EXPORT_PX = 8000

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Bounding box of everything drawn, in world coordinates. */
function worldBounds(layer: Konva.Layer, view: View) {
  const r = layer.getClientRect() // screen coords (includes the stage's pan/zoom)
  if (!r.width || !r.height) return null
  return {
    x: (r.x - view.x) / view.scale - PAD,
    y: (r.y - view.y) / view.scale - PAD,
    width: r.width / view.scale + PAD * 2,
    height: r.height / view.scale + PAD * 2,
  }
}

export async function exportPNG(layer: Konva.Layer, view: View, name: string) {
  const r = layer.getClientRect()
  if (!r.width || !r.height) return alert('The canvas is empty.')
  // Render at 2x world resolution, capped so huge boards don't exceed canvas limits.
  const pad = PAD * view.scale
  const pixelRatio = Math.min(2 / view.scale, MAX_EXPORT_PX / (Math.max(r.width, r.height) + pad * 2))
  const canvas = layer.toCanvas({
    x: r.x - pad,
    y: r.y - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
    pixelRatio,
  })
  // Flatten onto white so the PNG isn't transparent.
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0)
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
  if (blob) download(blob, `${name}.png`)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const paint = (c: string) => (!c || c === 'transparent' ? 'none' : esc(c))

export function exportSVG(
  shapes: Shape[],
  layer: Konva.Layer,
  nodes: Map<string, Konva.Node>,
  view: View,
  name: string
) {
  const b = worldBounds(layer, view)
  if (!b) return alert('The canvas is empty.')
  const body = shapes.map((s) => {
    const t = `transform="translate(${s.x} ${s.y}) rotate(${s.rotation || 0})"`
    const stroke = `stroke="${paint(s.stroke)}" stroke-width="${s.strokeWidth}"`
    switch (s.type) {
      case 'rect':
        return `<rect ${t} width="${s.width}" height="${s.height}" fill="${paint(s.fill)}" ${stroke}/>`
      case 'ellipse':
        return `<ellipse ${t} rx="${s.radiusX}" ry="${s.radiusY}" fill="${paint(s.fill)}" ${stroke}/>`
      case 'pen': {
        const p = s.points ?? []
        let d = ''
        for (let i = 0; i < p.length; i += 2) d += `${i ? 'L' : 'M'}${p[i]} ${p[i + 1]}`
        return `<path ${t} d="${d}" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"/>`
      }
      case 'text': {
        const fs = s.fontSize ?? 24
        const lh = fs * 1.2
        // Use Konva's wrapped lines so the SVG matches what's on screen.
        const node = nodes.get(s.id) as (Konva.Text & { textArr?: { text: string }[] }) | undefined
        const lines = node?.textArr?.map((l) => l.text) ?? (s.text ?? '').split('\n')
        const tspans = lines
          .map((line, i) => `<tspan x="0" y="${i * lh + lh / 2}">${esc(line) || ' '}</tspan>`)
          .join('')
        return `<text ${t} font-family="Inter, system-ui, sans-serif" font-size="${fs}" fill="${paint(s.stroke)}" dominant-baseline="middle" xml:space="preserve">${tspans}</text>`
      }
    }
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" width="${Math.round(b.width)}" height="${Math.round(b.height)}">
<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#ffffff"/>
${body.join('\n')}
</svg>`
  download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)
}

export function exportJSON(shapes: Shape[], name: string) {
  const data = { app: 'collab-canvas', version: 1, exportedAt: new Date().toISOString(), shapes }
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${name}.json`)
}

const TYPES = new Set(['pen', 'rect', 'ellipse', 'text'])
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)

/** Parse an exported JSON file into fresh shapes stacked above `baseZ`. Throws on invalid input. */
export function parseImport(text: string, baseZ: number): Shape[] {
  const data = JSON.parse(text)
  const raw: unknown[] = Array.isArray(data) ? data : data?.shapes
  if (!Array.isArray(raw)) throw new Error('No "shapes" array found.')
  return raw
    .filter((s: any) => s && TYPES.has(s.type))
    .sort((a: any, b: any) => num(a.z) - num(b.z))
    .map((s: any, i): Shape => ({
      id: newId(),
      type: s.type,
      x: num(s.x),
      y: num(s.y),
      rotation: num(s.rotation),
      z: baseZ + i,
      stroke: str(s.stroke, '#1e1e1e'),
      fill: str(s.fill, 'transparent'),
      strokeWidth: num(s.strokeWidth, 3),
      ...(s.type === 'rect' && { width: num(s.width, 100), height: num(s.height, 80) }),
      ...(s.type === 'ellipse' && { radiusX: num(s.radiusX, 50), radiusY: num(s.radiusY, 40) }),
      ...(s.type === 'pen' && {
        points: Array.isArray(s.points) ? s.points.filter((n: unknown) => typeof n === 'number') : [0, 0],
      }),
      ...(s.type === 'text' && {
        text: str(s.text, ''),
        fontSize: num(s.fontSize, 24),
        width: num(s.width, 240),
      }),
    }))
}
