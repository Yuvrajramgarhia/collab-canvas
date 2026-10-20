import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Stage, Layer, Rect, Ellipse, Line, Text, Transformer, Group, Path, Label, Tag } from 'react-konva'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { Peer, Shape, Style, Tool, UserInfo, View } from '../types'
import { addShapes, deleteShapes, getShapesMap, newId, updateShape, updateShapes, useShapes } from '../lib/doc'
import { throttle } from '../lib/throttle'
import { usePeers } from '../lib/presence'
import { exportJSON, exportPNG, exportSVG, parseImport } from '../lib/export'
import { Toolbar, StylePanel, TopBar, ZoomBar } from './Chrome'

type Interaction =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'pen'; id: string; ox: number; oy: number; points: number[] }
  | { kind: 'box'; id: string; type: 'rect' | 'ellipse'; x0: number; y0: number; x1: number; y1: number; shift: boolean }

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const FONT = 'Inter, system-ui, sans-serif'
const LINE_HEIGHT = 1.2
const DEFAULT_TEXT_WIDTH = 240
const DEFAULT_FONT_SIZE = 24

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

/** Walk up from a Konva hit target to the shape node (ignores transformer handles). */
function shapeIdOf(node: Konva.Node | null): string | null {
  while (node && !(node instanceof Konva.Stage)) {
    if (node instanceof Konva.Transformer) return null
    if (node.hasName('shape')) return node.id()
    node = node.getParent()
  }
  return null
}

function boxGeometry(it: Extract<Interaction, { kind: 'box' }>): Partial<Shape> {
  let w = it.x1 - it.x0
  let h = it.y1 - it.y0
  if (it.shift) {
    const side = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w || 1) * side
    h = Math.sign(h || 1) * side
  }
  const x = Math.min(it.x0, it.x0 + w)
  const y = Math.min(it.y0, it.y0 + h)
  return it.type === 'rect'
    ? { x, y, width: Math.abs(w), height: Math.abs(h) }
    : { x: x + Math.abs(w) / 2, y: y + Math.abs(h) / 2, radiusX: Math.abs(w) / 2, radiusY: Math.abs(h) / 2 }
}

interface Props {
  doc: Y.Doc
  awareness: Awareness
  roomId: string
  status: string
  synced: boolean
  user: UserInfo
  onUserChange: (u: UserInfo) => void
  onLeave: () => void
}

export function Whiteboard({ doc, awareness, roomId, status, synced, user, onUserChange, onLeave }: Props) {
  const shapesMap = useMemo(() => getShapesMap(doc), [doc])
  const shapes = useShapes(shapesMap)
  const shapesById = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes])
  const peers = usePeers(awareness)

  const [tool, setTool] = useState<Tool>('select')
  const [style, setStyle] = useState<Style>({ stroke: '#1e1e1e', fill: 'transparent', strokeWidth: 3 })
  const [selected, setSelected] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)

  const stageRef = useRef<Konva.Stage>(null)
  const layerRef = useRef<Konva.Layer>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const nodes = useRef(new Map<string, Konva.Node>())
  const interaction = useRef<Interaction | null>(null)

  // Latest values for stable callbacks (Konva handlers, throttled fns, window listeners).
  const latest = useRef({ selected, tool, shapes, shapesById, style, view, editingId, spaceDown })
  latest.current = { selected, tool, shapes, shapesById, style, view, editingId, spaceDown }

  // ---------- Undo / redo (per user: UndoManager only tracks this client's local transactions) ----------
  const undoManager = useMemo(() => new Y.UndoManager(shapesMap, { captureTimeout: 300 }), [shapesMap])
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  useEffect(() => {
    const sync = () =>
      setHistory({ canUndo: undoManager.undoStack.length > 0, canRedo: undoManager.redoStack.length > 0 })
    undoManager.on('stack-item-added', sync)
    undoManager.on('stack-item-popped', sync)
    undoManager.on('stack-cleared', sync)
    return () => undoManager.destroy()
  }, [undoManager])
  const undo = useCallback(() => undoManager.undo(), [undoManager])
  const redo = useCallback(() => undoManager.redo(), [undoManager])

  // ---------- Presence ----------
  useEffect(() => awareness.setLocalStateField('user', user), [awareness, user])
  const sendCursor = useMemo(
    () => throttle((cursor: { x: number; y: number } | null) => awareness.setLocalStateField('cursor', cursor), 33),
    [awareness]
  )

  // ---------- Layout ----------
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Drop selections of shapes that were deleted (locally, remotely, or by undo).
  useEffect(() => {
    setSelected((sel) => (sel.every((id) => shapesById.has(id)) ? sel : sel.filter((id) => shapesById.has(id))))
    if (editingId && !shapesById.has(editingId)) setEditingId(null)
  }, [shapesById, editingId])

  // Attach the transformer to the selected nodes.
  useLayoutEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const attached = tool === 'select' ? selected.filter((id) => id !== editingId) : []
    tr.nodes(attached.map((id) => nodes.current.get(id)).filter((n): n is Konva.Node => !!n))
    tr.getLayer()?.batchDraw()
  }, [selected, editingId, shapes, tool])

  // Reflect the selected shape's colors in the style panel.
  useEffect(() => {
    if (selected.length !== 1) return
    const s = latest.current.shapesById.get(selected[0])
    if (s) setStyle({ stroke: s.stroke, fill: s.fill, strokeWidth: s.strokeWidth })
  }, [selected])

  const register = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodes.current.set(id, node)
    else nodes.current.delete(id)
  }, [])

  const nextZ = () => {
    const s = latest.current.shapes
    return s.length ? s[s.length - 1].z + 1 : 0
  }

  // ---------- Drawing (writes go to the local Y.Doc immediately = instant local render; ≤60/s) ----------
  const flushDraw = useMemo(
    () =>
      throttle(() => {
        const it = interaction.current
        if (!it) return
        if (it.kind === 'pen') {
          const m = shapesMap.get(it.id)
          const arr = m?.get('points') as Y.Array<number> | undefined
          if (arr && arr.length < it.points.length) doc.transact(() => arr.push(it.points.slice(arr.length)))
        } else if (it.kind === 'box') {
          updateShape(doc, it.id, boxGeometry(it))
        }
      }, 16),
    [doc, shapesMap]
  )

  const finishInteraction = useCallback(() => {
    const it = interaction.current
    if (!it) return
    flushDraw.flush()
    interaction.current = null
    if (it.kind === 'pan') {
      setPanning(false)
      return
    }
    if (it.kind === 'pen') {
      // A click without movement still leaves a dot.
      if (it.points.length === 2) {
        const arr = shapesMap.get(it.id)?.get('points') as Y.Array<number> | undefined
        arr?.push([0.01, 0])
      }
    } else if (it.kind === 'box') {
      const minSize = 4 / latest.current.view.scale
      if (Math.abs(it.x1 - it.x0) < minSize && Math.abs(it.y1 - it.y0) < minSize) {
        // Plain click: drop a default-sized shape.
        updateShape(
          doc,
          it.id,
          it.type === 'rect'
            ? { x: it.x0 - 60, y: it.y0 - 40, width: 120, height: 80 }
            : { x: it.x0, y: it.y0, radiusX: 60, radiusY: 40 }
        )
      }
      setSelected([it.id])
      setTool('select')
    }
    undoManager.stopCapturing()
  }, [doc, shapesMap, flushDraw, undoManager])

  useEffect(() => {
    window.addEventListener('pointerup', finishInteraction)
    window.addEventListener('pointercancel', finishInteraction)
    return () => {
      window.removeEventListener('pointerup', finishInteraction)
      window.removeEventListener('pointercancel', finishInteraction)
    }
  }, [finishInteraction])

  const createText = (x: number, y: number) => {
    const { style } = latest.current
    const id = newId()
    undoManager.stopCapturing()
    addShapes(doc, [
      {
        id, type: 'text', x, y, rotation: 0, z: nextZ(),
        stroke: style.stroke, fill: 'transparent', strokeWidth: style.strokeWidth,
        text: '', fontSize: DEFAULT_FONT_SIZE, width: DEFAULT_TEXT_WIDTH,
      },
    ])
    setSelected([id])
    setEditingId(id)
    setTool('select')
  }

  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt
    const stage = stageRef.current!
    if (evt.button === 1 || tool === 'hand' || spaceDown) {
      interaction.current = { kind: 'pan', sx: evt.clientX, sy: evt.clientY, vx: view.x, vy: view.y }
      setPanning(true)
      return
    }
    if (evt.button !== 0) return
    const p = stage.getRelativePointerPosition()!
    const targetId = shapeIdOf(e.target)
    const onTransformer = e.target.getParent() instanceof Konva.Transformer

    switch (tool) {
      case 'select': {
        if (onTransformer) return
        if (!targetId) return setSelected([])
        if (evt.shiftKey)
          setSelected((s) => (s.includes(targetId) ? s.filter((id) => id !== targetId) : [...s, targetId]))
        else if (!selected.includes(targetId)) setSelected([targetId])
        return
      }
      case 'pen': {
        const id = newId()
        undoManager.stopCapturing()
        addShapes(doc, [
          {
            id, type: 'pen', x: p.x, y: p.y, rotation: 0, z: nextZ(),
            stroke: style.stroke, fill: 'transparent', strokeWidth: style.strokeWidth, points: [0, 0],
          },
        ])
        interaction.current = { kind: 'pen', id, ox: p.x, oy: p.y, points: [0, 0] }
        setSelected([])
        return
      }
      case 'rect':
      case 'ellipse': {
        const id = newId()
        undoManager.stopCapturing()
        const geom = tool === 'rect' ? { width: 0, height: 0 } : { radiusX: 0, radiusY: 0 }
        addShapes(doc, [
          { id, type: tool, x: p.x, y: p.y, rotation: 0, z: nextZ(), ...style, ...geom },
        ])
        interaction.current = { kind: 'box', id, type: tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y, shift: evt.shiftKey }
        setSelected([])
        return
      }
      case 'text': {
        // Stop the follow-up mousedown from stealing focus from the new editor (which would close it).
        evt.preventDefault()
        if (targetId && shapesById.get(targetId)?.type === 'text') {
          setSelected([targetId])
          setEditingId(targetId)
          setTool('select')
        } else {
          createText(p.x, p.y)
        }
        return
      }
    }
  }

  const onPointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const p = stageRef.current!.getRelativePointerPosition()
    if (p) sendCursor({ x: p.x, y: p.y })
    const it = interaction.current
    if (!it) return
    if (it.kind === 'pan') {
      setView((v) => ({ ...v, x: it.vx + e.evt.clientX - it.sx, y: it.vy + e.evt.clientY - it.sy }))
    } else if (it.kind === 'pen' && p) {
      const dx = p.x - it.ox
      const dy = p.y - it.oy
      const n = it.points.length
      // Skip sub-pixel jitter.
      if (Math.hypot(dx - it.points[n - 2], dy - it.points[n - 1]) * view.scale < 1) return
      it.points.push(dx, dy)
      flushDraw()
    } else if (it.kind === 'box' && p) {
      it.x1 = p.x
      it.y1 = p.y
      it.shift = e.evt.shiftKey
      flushDraw()
    }
  }

  const onPointerLeave = () => {
    sendCursor(null)
    sendCursor.flush()
  }

  // Native dblclick (not Konva's): Konva fires dblclick for any two clicks within 400ms, even far apart.
  const onDoubleClick = (e: React.MouseEvent) => {
    const stage = stageRef.current
    if (tool !== 'select' || !stage || !(e.target instanceof HTMLCanvasElement)) return
    stage.setPointersPositions(e.nativeEvent)
    const hit = stage.getIntersection(stage.getPointerPosition()!)
    const id = shapeIdOf(hit)
    if (id && shapesById.get(id)?.type === 'text') {
      setSelected([id])
      setEditingId(id)
    } else if (!hit) {
      const p = stage.getRelativePointerPosition()!
      createText(p.x, p.y)
    }
  }

  // ---------- Pan & zoom ----------
  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    setView((v) => {
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      const wx = (sx - v.x) / v.scale
      const wy = (sy - v.y) / v.scale
      return { scale, x: sx - wx * scale, y: sy - wy * scale }
    })
  }, [])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const { deltaX, deltaY, ctrlKey, metaKey } = e.evt
    if (ctrlKey || metaKey) {
      // Pinch-zoom on trackpads arrives as ctrl+wheel.
      const pointer = stageRef.current!.getPointerPosition()!
      zoomAt(Math.exp(-clamp(deltaY, -25, 25) * 0.01), pointer.x, pointer.y)
    } else {
      setView((v) => ({ ...v, x: v.x - deltaX, y: v.y - deltaY }))
    }
  }

  const zoomCenter = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2)
  const resetView = () => setView({ x: 0, y: 0, scale: 1 })
  const zoomToFit = () => {
    const layer = layerRef.current
    if (!layer || !shapes.length) return resetView()
    const r = layer.getClientRect()
    const world = { x: (r.x - view.x) / view.scale, y: (r.y - view.y) / view.scale, w: r.width / view.scale, h: r.height / view.scale }
    const scale = clamp(Math.min((size.w - 160) / world.w, (size.h - 200) / world.h), MIN_SCALE, 2)
    setView({ scale, x: size.w / 2 - (world.x + world.w / 2) * scale, y: size.h / 2 - (world.y + world.h / 2) * scale })
  }

  // ---------- Object controls ----------
  const writeDragPositions = useCallback(() => {
    const patches = new Map<string, Partial<Shape>>()
    for (const id of latest.current.selected) {
      const n = nodes.current.get(id)
      if (n) patches.set(id, { x: n.x(), y: n.y() })
    }
    updateShapes(doc, patches)
  }, [doc])
  const syncDrag = useMemo(() => throttle(writeDragPositions, 33), [writeDragPositions])

  const shapeHandlers = useMemo<ShapeHandlers>(
    () => ({
      dragStart: (e) => {
        undoManager.stopCapturing()
        const id = e.target.id()
        if (!latest.current.selected.includes(id)) {
          latest.current.selected = [id]
          setSelected([id])
        }
      },
      dragMove: () => syncDrag(),
      dragEnd: () => {
        syncDrag.cancel()
        writeDragPositions()
        undoManager.stopCapturing()
      },
      transform: (e) => {
        // Text reflows instead of stretching horizontally.
        const n = e.target
        if (n instanceof Konva.Text) n.setAttrs({ width: Math.max(30, n.width() * n.scaleX()), scaleX: 1 })
      },
      transformEnd: (e) => {
        const n = e.target
        const s = latest.current.shapesById.get(n.id())
        if (!s) return
        const sx = n.scaleX()
        const sy = n.scaleY()
        n.scale({ x: 1, y: 1 })
        const patch: Partial<Shape> = { x: n.x(), y: n.y(), rotation: n.rotation() }
        if (s.type === 'rect') {
          patch.width = Math.max(1, n.width() * sx)
          patch.height = Math.max(1, n.height() * sy)
        } else if (s.type === 'ellipse') {
          const el = n as Konva.Ellipse
          patch.radiusX = Math.max(1, el.radiusX() * sx)
          patch.radiusY = Math.max(1, el.radiusY() * sy)
        } else if (s.type === 'pen') {
          patch.points = (s.points ?? []).map((v, i) => (i % 2 ? v * sy : v * sx))
        } else if (s.type === 'text') {
          patch.width = n.width()
          patch.fontSize = clamp((s.fontSize ?? DEFAULT_FONT_SIZE) * sy, 6, 400)
        }
        updateShape(doc, s.id, patch)
      },
    }),
    [doc, undoManager, syncDrag, writeDragPositions]
  )

  const applyStyle = (patch: Partial<Style>) => {
    setStyle((s) => ({ ...s, ...patch }))
    if (!selected.length) return
    undoManager.stopCapturing()
    updateShapes(doc, new Map(selected.map((id) => [id, patch])))
  }

  const deleteSelected = useCallback(() => {
    const ids = latest.current.selected
    if (!ids.length) return
    undoManager.stopCapturing()
    deleteShapes(doc, ids)
    setSelected([])
  }, [doc, undoManager])

  const duplicateSelected = useCallback(() => {
    const { selected, shapesById } = latest.current
    if (!selected.length) return
    let z = nextZ()
    const copies = selected
      .map((id) => shapesById.get(id))
      .filter((s): s is Shape => !!s)
      .sort((a, b) => a.z - b.z)
      .map((s) => ({ ...s, id: newId(), x: s.x + 20, y: s.y + 20, z: z++ }))
    undoManager.stopCapturing()
    addShapes(doc, copies)
    setSelected(copies.map((c) => c.id))
  }, [doc, undoManager])

  const reorder = useCallback(
    (where: 'front' | 'back') => {
      const { selected, shapes } = latest.current
      if (!selected.length || !shapes.length) return
      const ordered = shapes.filter((s) => selected.includes(s.id))
      const base = where === 'front' ? shapes[shapes.length - 1].z + 1 : shapes[0].z - ordered.length
      undoManager.stopCapturing()
      updateShapes(doc, new Map(ordered.map((s, i) => [s.id, { z: base + i }])))
    },
    [doc, undoManager]
  )

  const clearBoard = () => {
    if (!shapes.length || !confirm('Delete everything on this board for everyone in the room?')) return
    undoManager.stopCapturing()
    deleteShapes(doc, shapes.map((s) => s.id))
  }

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (e.key === ' ') {
        e.preventDefault()
        if (!e.repeat) setSpaceDown(true)
        return
      }
      if (mod && key === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        redo()
      } else if (mod && key === 'a') {
        e.preventDefault()
        setTool('select')
        setSelected(latest.current.shapes.map((s) => s.id))
      } else if (mod && key === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (mod && (key === '=' || key === '+')) {
        e.preventDefault()
        zoomAt(1.2, window.innerWidth / 2, window.innerHeight / 2)
      } else if (mod && key === '-') {
        e.preventDefault()
        zoomAt(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2)
      } else if (mod && key === '0') {
        e.preventDefault()
        setView({ x: 0, y: 0, scale: 1 })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      } else if (e.key === 'Escape') {
        setSelected([])
        setTool('select')
      } else if (e.key === ']') {
        reorder('front')
      } else if (e.key === '[') {
        reorder('back')
      } else if (!mod && !e.altKey) {
        const tools: Record<string, Tool> = { v: 'select', h: 'hand', p: 'pen', r: 'rect', o: 'ellipse', t: 'text',
          '1': 'select', '2': 'hand', '3': 'pen', '4': 'rect', '5': 'ellipse', '6': 'text' }
        if (tools[key]) setTool(tools[key])
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [undo, redo, deleteSelected, duplicateSelected, reorder, zoomAt])

  // ---------- Export / import ----------
  const fileName = `board-${roomId}`
  const onExport = (format: 'png' | 'svg' | 'json') => {
    setSelected([])
    const layer = layerRef.current
    if (!layer) return
    if (format === 'png') exportPNG(layer, view, fileName)
    else if (format === 'svg') exportSVG(shapes, layer, nodes.current, view, fileName)
    else exportJSON(shapes, fileName)
  }
  const onImport = async (file: File) => {
    try {
      const imported = parseImport(await file.text(), nextZ())
      if (!imported.length) return alert('No shapes found in that file.')
      undoManager.stopCapturing()
      addShapes(doc, imported)
      setSelected(imported.map((s) => s.id))
      setTool('select')
    } catch (err) {
      alert(`Could not import: ${(err as Error).message}`)
    }
  }

  // ---------- Render ----------
  const editing = editingId ? shapesById.get(editingId) : undefined
  const grid = view.scale < 0.5 ? 96 * view.scale : 24 * view.scale
  const cursor = panning ? 'grabbing' : tool === 'hand' || spaceDown ? 'grab'
    : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div
      className="board"
      onDoubleClick={onDoubleClick}
      style={{ cursor, backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
      >
        <Layer ref={layerRef}>
          {shapes.map((s) => (
            <ShapeNode
              key={s.id}
              shape={s}
              draggable={tool === 'select' && !spaceDown}
              hidden={s.id === editingId}
              register={register}
              handlers={shapeHandlers}
            />
          ))}
        </Layer>
        <Layer>
          <Transformer
            ref={trRef}
            ignoreStroke
            keepRatio={false}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            anchorSize={8 / Math.sqrt(view.scale) + 2}
            borderStroke="#4c6ef5"
            anchorStroke="#4c6ef5"
            boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5 ? oldBox : newBox)}
          />
          {peers.map((p) => p.cursor && <RemoteCursor key={p.clientId} peer={p} scale={view.scale} />)}
        </Layer>
      </Stage>

      {editing && (
        <TextEditor
          key={editing.id}
          shape={editing}
          view={view}
          onChange={(text) => updateShape(doc, editing.id, { text })}
          onDone={() => {
            const current = shapesMap.get(editing.id)?.get('text')?.toString() ?? ''
            if (!current.trim()) deleteShapes(doc, [editing.id])
            setEditingId(null)
            undoManager.stopCapturing()
          }}
        />
      )}

      <TopBar
        roomId={roomId}
        status={status}
        synced={synced}
        user={user}
        peers={peers}
        onUserChange={onUserChange}
        onLeave={onLeave}
        onExport={onExport}
        onImport={onImport}
        onClear={clearBoard}
      />
      <Toolbar tool={tool} onTool={setTool} />
      <StylePanel
        style={style}
        hasSelection={selected.length > 0}
        onStyle={applyStyle}
        onDelete={deleteSelected}
        onDuplicate={duplicateSelected}
        onFront={() => reorder('front')}
        onBack={() => reorder('back')}
      />
      <ZoomBar
        scale={view.scale}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        onZoomIn={() => zoomCenter(1.2)}
        onZoomOut={() => zoomCenter(1 / 1.2)}
        onReset={resetView}
        onFit={zoomToFit}
      />
    </div>
  )
}

// ---------- Shape rendering ----------

type KEvt = Konva.KonvaEventObject<Event>
interface ShapeHandlers {
  dragStart: (e: KEvt) => void
  dragMove: (e: KEvt) => void
  dragEnd: (e: KEvt) => void
  transform: (e: KEvt) => void
  transformEnd: (e: KEvt) => void
}

interface ShapeNodeProps {
  shape: Shape
  draggable: boolean
  hidden: boolean
  register: (id: string, node: Konva.Node | null) => void
  handlers: ShapeHandlers
}

const ShapeNode = memo(function ShapeNode({ shape: s, draggable, hidden, register, handlers }: ShapeNodeProps) {
  const ref = useCallback((n: Konva.Node | null) => register(s.id, n), [register, s.id])
  const common = {
    ref,
    id: s.id,
    name: 'shape',
    x: s.x,
    y: s.y,
    rotation: s.rotation,
    draggable,
    visible: !hidden,
    perfectDrawEnabled: false,
    onDragStart: handlers.dragStart,
    onDragMove: handlers.dragMove,
    onDragEnd: handlers.dragEnd,
    onTransform: handlers.transform,
    onTransformEnd: handlers.transformEnd,
  }
  switch (s.type) {
    // A 'transparent' fill still registers hits, so empty shapes can be grabbed from the inside.
    case 'rect':
      return (
        <Rect {...common} width={s.width} height={s.height} stroke={s.stroke} strokeWidth={s.strokeWidth}
          fill={s.fill} cornerRadius={2} hitStrokeWidth={Math.max(10, s.strokeWidth)} />
      )
    case 'ellipse':
      return (
        <Ellipse {...common} radiusX={s.radiusX ?? 0} radiusY={s.radiusY ?? 0} stroke={s.stroke}
          strokeWidth={s.strokeWidth} fill={s.fill} hitStrokeWidth={Math.max(10, s.strokeWidth)} />
      )
    case 'pen':
      return (
        <Line {...common} points={s.points ?? []} stroke={s.stroke} strokeWidth={s.strokeWidth}
          lineCap="round" lineJoin="round" hitStrokeWidth={Math.max(12, s.strokeWidth + 8)} />
      )
    case 'text':
      return (
        <Text {...common} text={s.text ?? ''} fontSize={s.fontSize ?? DEFAULT_FONT_SIZE} width={s.width ?? DEFAULT_TEXT_WIDTH}
          fill={s.stroke} fontFamily={FONT} lineHeight={LINE_HEIGHT} wrap="word" />
      )
  }
})

const RemoteCursor = memo(function RemoteCursor({ peer, scale }: { peer: Peer; scale: number }) {
  const { cursor, user } = peer
  return (
    <Group x={cursor!.x} y={cursor!.y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
      <Path data="M0 0 L0 17 L4.6 12.6 L7.8 19.8 L10.6 18.6 L7.5 11.6 L13.5 11.6 Z" fill={user.color} stroke="#fff" strokeWidth={1.5} />
      <Label x={14} y={18}>
        <Tag fill={user.color} cornerRadius={4} />
        <Text text={user.name} fill="#fff" fontSize={12} fontFamily={FONT} padding={4} />
      </Label>
    </Group>
  )
})

// ---------- In-place text editing ----------

function TextEditor({ shape, view, onChange, onDone }: {
  shape: Shape
  view: View
  onChange: (text: string) => void
  onDone: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fontSize = (shape.fontSize ?? DEFAULT_FONT_SIZE) * view.scale

  useLayoutEffect(() => {
    const el = ref.current!
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // Grow with content.
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  })

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={shape.text ?? ''}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          ref.current!.blur()
        }
      }}
      style={{
        left: shape.x * view.scale + view.x,
        top: shape.y * view.scale + view.y,
        width: (shape.width ?? DEFAULT_TEXT_WIDTH) * view.scale,
        fontSize,
        lineHeight: LINE_HEIGHT,
        fontFamily: FONT,
        color: shape.stroke,
        transform: `rotate(${shape.rotation || 0}deg)`,
      }}
    />
  )
}
