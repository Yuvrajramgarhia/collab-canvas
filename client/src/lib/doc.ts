import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { Shape } from '../types'

/**
 * Document layout:
 *   doc.getMap('shapes'): Y.Map<id, Y.Map<field, value>>
 * Each shape is its own Y.Map, so concurrent edits to different fields of the
 * same shape (one user moves it, another recolors it) both survive. `points` is a
 * Y.Array so a stroke streams incrementally, and `text` is a Y.Text so two people
 * typing in the same text block merge character-by-character.
 */
export type YShape = Y.Map<unknown>
export type ShapesMap = Y.Map<YShape>

export const getShapesMap = (doc: Y.Doc): ShapesMap => doc.getMap<YShape>('shapes')

export function newId(len = 12): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function toYShape(shape: Shape): YShape {
  const m = new Y.Map<unknown>()
  for (const [key, value] of Object.entries(shape)) {
    if (value === undefined) continue
    if (key === 'points') {
      const arr = new Y.Array<number>()
      arr.push(value as number[])
      m.set(key, arr)
    } else if (key === 'text') {
      m.set(key, new Y.Text(value as string))
    } else {
      m.set(key, value)
    }
  }
  return m
}

export function addShapes(doc: Y.Doc, shapes: Shape[]) {
  const map = getShapesMap(doc)
  doc.transact(() => shapes.forEach((s) => map.set(s.id, toYShape(s))))
}

/** Must be called inside a transaction (or will create one per field). */
function patchYShape(m: YShape, patch: Partial<Shape>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === 'id') continue
    if (key === 'points') {
      const arr = m.get('points') as Y.Array<number>
      arr.delete(0, arr.length)
      arr.push(value as number[])
    } else if (key === 'text') {
      applyTextDiff(m.get('text') as Y.Text, value as string)
    } else if (m.get(key) !== value) {
      m.set(key, value)
    }
  }
}

export function updateShape(doc: Y.Doc, id: string, patch: Partial<Shape>) {
  const m = getShapesMap(doc).get(id)
  if (m) doc.transact(() => patchYShape(m, patch))
}

export function updateShapes(doc: Y.Doc, patches: Map<string, Partial<Shape>>) {
  const map = getShapesMap(doc)
  doc.transact(() => {
    patches.forEach((patch, id) => {
      const m = map.get(id)
      if (m) patchYShape(m, patch)
    })
  })
}

export function deleteShapes(doc: Y.Doc, ids: string[]) {
  const map = getShapesMap(doc)
  doc.transact(() => ids.forEach((id) => map.delete(id)))
}

/** Turn a whole-string edit into a minimal delete+insert so concurrent typing merges. */
function applyTextDiff(ytext: Y.Text, next: string) {
  const prev = ytext.toString()
  if (prev === next) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  if (endPrev > start) ytext.delete(start, endPrev - start)
  if (endNext > start) ytext.insert(start, next.slice(start, endNext))
}

const byStackOrder = (a: Shape, b: Shape) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Subscribe to the shapes map. Only shapes touched by a change are re-read, and
 * untouched shapes keep object identity so memoized nodes skip re-rendering.
 */
export function useShapes(map: ShapesMap): Shape[] {
  const [shapes, setShapes] = useState<Shape[]>([])

  useEffect(() => {
    const cache = new Map<string, Shape>()
    map.forEach((m, id) => cache.set(id, m.toJSON() as Shape))
    const publish = () => setShapes([...cache.values()].sort(byStackOrder))
    publish()

    const onChange = (events: Y.YEvent<any>[]) => {
      const dirty = new Set<string>()
      for (const ev of events) {
        if (ev.target === map) ev.changes.keys.forEach((_, key) => dirty.add(key))
        else dirty.add(ev.path[0] as string)
      }
      dirty.forEach((id) => {
        const m = map.get(id)
        if (m) cache.set(id, m.toJSON() as Shape)
        else cache.delete(id)
      })
      publish()
    }
    map.observeDeep(onChange)
    return () => map.unobserveDeep(onChange)
  }, [map])

  return shapes
}
