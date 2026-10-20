import { useEffect, useRef, useState } from 'react'
import type { Peer, Style, Tool, UserInfo } from '../types'
import { initials, USER_COLORS } from '../lib/user'
import { Icons } from './Icons'

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'hand', label: 'Pan', key: 'H' },
  { id: 'pen', label: 'Draw', key: 'P' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', key: 'O' },
  { id: 'text', label: 'Text', key: 'T' },
]

export function Toolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <div className="panel toolbar" role="toolbar" aria-label="Tools">
      {TOOLS.map((t, i) => (
        <button
          key={t.id}
          className={`icon-btn ${tool === t.id ? 'active' : ''}`}
          title={`${t.label} (${t.key} or ${i + 1})`}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => onTool(t.id)}
        >
          {Icons[t.id]}
          <span className="kbd">{i + 1}</span>
        </button>
      ))}
    </div>
  )
}

const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#7048e8']
const FILLS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#e5dbff']
const WIDTHS = [2, 3, 6, 10]

function Swatches({ colors, value, onPick, label }: {
  colors: string[]
  value: string
  onPick: (c: string) => void
  label: string
}) {
  const custom = !colors.includes(value)
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch ${c === 'transparent' ? 'none' : ''} ${value === c ? 'active' : ''}`}
          style={c === 'transparent' ? undefined : { background: c }}
          title={c === 'transparent' ? 'No fill' : c}
          aria-label={c === 'transparent' ? 'No fill' : c}
          role="radio"
          aria-checked={value === c}
          onClick={() => onPick(c)}
        />
      ))}
      <label className={`swatch custom ${custom ? 'active' : ''}`} title="Custom color"
        style={custom && value !== 'transparent' ? { background: value } : undefined}>
        <input type="color" value={value === 'transparent' ? '#ffffff' : value} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

export function StylePanel({ style, hasSelection, onStyle, onDelete, onDuplicate, onFront, onBack }: {
  style: Style
  hasSelection: boolean
  onStyle: (patch: Partial<Style>) => void
  onDelete: () => void
  onDuplicate: () => void
  onFront: () => void
  onBack: () => void
}) {
  return (
    <div className="panel style-panel">
      <div className="section-label">Stroke / text</div>
      <Swatches label="Stroke color" colors={STROKES} value={style.stroke} onPick={(stroke) => onStyle({ stroke })} />
      <div className="section-label">Fill</div>
      <Swatches label="Fill color" colors={FILLS} value={style.fill} onPick={(fill) => onStyle({ fill })} />
      <div className="section-label">Width</div>
      <div className="widths">
        {WIDTHS.map((w) => (
          <button key={w} className={`icon-btn ${style.strokeWidth === w ? 'active' : ''}`}
            title={`${w}px`} aria-label={`Stroke width ${w}`} onClick={() => onStyle({ strokeWidth: w })}>
            <span className="width-dot" style={{ height: Math.min(w, 10) }} />
          </button>
        ))}
      </div>
      {hasSelection && (
        <>
          <div className="section-label">Selection</div>
          <div className="widths">
            <button className="icon-btn" title="Bring to front ( ] )" aria-label="Bring to front" onClick={onFront}>{Icons.front}</button>
            <button className="icon-btn" title="Send to back ( [ )" aria-label="Send to back" onClick={onBack}>{Icons.back}</button>
            <button className="icon-btn" title="Duplicate (⌘D)" aria-label="Duplicate" onClick={onDuplicate}>{Icons.duplicate}</button>
            <button className="icon-btn danger" title="Delete (Del)" aria-label="Delete" onClick={onDelete}>{Icons.trash}</button>
          </div>
        </>
      )}
    </div>
  )
}

export function ZoomBar(p: {
  scale: number
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
}) {
  return (
    <div className="bottom-bar">
      <div className="panel row">
        <button className="icon-btn" onClick={p.onZoomOut} title="Zoom out (⌘−)" aria-label="Zoom out">−</button>
        <button className="text-btn zoom-label" onClick={p.onReset} title="Reset to 100% (⌘0)">{Math.round(p.scale * 100)}%</button>
        <button className="icon-btn" onClick={p.onZoomIn} title="Zoom in (⌘+)" aria-label="Zoom in">+</button>
        <button className="text-btn" onClick={p.onFit} title="Zoom to fit content">Fit</button>
      </div>
      <div className="panel row">
        <button className="icon-btn" disabled={!p.canUndo} onClick={p.onUndo} title="Undo (⌘Z)" aria-label="Undo">{Icons.undo}</button>
        <button className="icon-btn" disabled={!p.canRedo} onClick={p.onRedo} title="Redo (⌘⇧Z)" aria-label="Redo">{Icons.redo}</button>
      </div>
    </div>
  )
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open, close])
  return ref
}

export function TopBar(p: {
  roomId: string
  status: string
  synced: boolean
  user: UserInfo
  peers: Peer[]
  onUserChange: (u: UserInfo) => void
  onLeave: () => void
  onExport: (f: 'png' | 'svg' | 'json') => void
  onImport: (file: File) => void
  onClear: () => void
}) {
  const [menu, setMenu] = useState<'export' | 'profile' | null>(null)
  const [copied, setCopied] = useState(false)
  const close = () => setMenu(null)
  const menuRef = useOutsideClose(menu !== null, close)
  const fileRef = useRef<HTMLInputElement>(null)

  const statusLabel = p.status === 'connected' ? (p.synced ? 'Live · auto-saving' : 'Syncing…')
    : p.status === 'connecting' ? 'Connecting…' : 'Offline · will sync'

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      prompt('Copy this link:', window.location.href)
    }
  }

  return (
    <>
      <div className="panel top-left row">
        <button className="icon-btn" onClick={p.onLeave} title="Home" aria-label="Home">{Icons.home}</button>
        <div className="room-info">
          <div className="room-name">Room <code>{p.roomId}</code></div>
          <div className={`status ${p.status}`}><span className="dot" />{statusLabel}</div>
        </div>
      </div>

      <div className="top-right row" ref={menuRef}>
        <div className="avatars">
          {p.peers.slice(0, 5).map((peer) => (
            <span key={peer.clientId} className="avatar" style={{ background: peer.user.color }} title={peer.user.name}>
              {initials(peer.user.name)}
            </span>
          ))}
          {p.peers.length > 5 && <span className="avatar more">+{p.peers.length - 5}</span>}
          <button className="avatar me" style={{ background: p.user.color }} title={`You: ${p.user.name}`}
            onClick={() => setMenu(menu === 'profile' ? null : 'profile')}>
            {initials(p.user.name)}
          </button>
        </div>
        <button className="primary-btn" onClick={copyLink}>{Icons.link}{copied ? 'Copied!' : 'Share'}</button>
        <button className="panel-btn" onClick={() => setMenu(menu === 'export' ? null : 'export')} aria-haspopup="menu">
          {Icons.download}Export
        </button>

        {menu === 'export' && (
          <div className="panel menu" role="menu">
            <button role="menuitem" onClick={() => { p.onExport('png'); close() }}>Export PNG</button>
            <button role="menuitem" onClick={() => { p.onExport('svg'); close() }}>Export SVG</button>
            <button role="menuitem" onClick={() => { p.onExport('json'); close() }}>Export JSON</button>
            <hr />
            <button role="menuitem" onClick={() => fileRef.current?.click()}>Import JSON…</button>
            <button role="menuitem" className="danger" onClick={() => { close(); p.onClear() }}>Clear board</button>
          </div>
        )}
        {menu === 'profile' && (
          <div className="panel menu profile">
            <label className="section-label" htmlFor="display-name">Your name</label>
            <input id="display-name" value={p.user.name} maxLength={32}
              onChange={(e) => p.onUserChange({ ...p.user, name: e.target.value })} />
            <div className="section-label">Cursor color</div>
            <div className="swatches">
              {USER_COLORS.map((c) => (
                <button key={c} className={`swatch ${p.user.color === c ? 'active' : ''}`} style={{ background: c }}
                  aria-label={c} onClick={() => p.onUserChange({ ...p.user, color: c })} />
              ))}
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) p.onImport(f)
            e.target.value = ''
            close()
          }} />
      </div>
    </>
  )
}
