// End-to-end check: two clients sync shapes + presence; state survives a server restart.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const URL = process.env.WS_URL ?? 'ws://localhost:1234/yjs'
const room = process.argv[2] ?? `test-${Date.now()}`
const phase = process.argv[3] ?? 'write'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const synced = (p) => new Promise((r) => (p.synced ? r() : p.once('sync', r)))
const client = () => {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(URL, room, doc, { WebSocketPolyfill: WebSocket, disableBc: true })
  return { doc, provider, shapes: doc.getMap('shapes') }
}
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1) } console.log('ok -', msg) }

if (phase === 'write') {
  const a = client(), b = client()
  await Promise.all([synced(a.provider), synced(b.provider)])

  // A creates a rect, B sees it
  const m = new Y.Map(); m.set('id', 'r1'); m.set('type', 'rect'); m.set('x', 10); m.set('fill', 'transparent')
  a.shapes.set('r1', m)
  await wait(200)
  assert(b.shapes.get('r1')?.get('x') === 10, 'shape created on A appears on B')

  // Concurrent edits to different fields of the same shape both survive
  a.shapes.get('r1').set('x', 99)
  b.shapes.get('r1').set('fill', '#ff0000')
  await wait(200)
  for (const c of [a, b]) assert(c.shapes.get('r1').get('x') === 99 && c.shapes.get('r1').get('fill') === '#ff0000', 'concurrent move + recolor merged')

  // Concurrent typing into the same Y.Text merges
  const t = new Y.Map(); t.set('id', 't1'); t.set('type', 'text'); t.set('text', new Y.Text('hello'))
  a.shapes.set('t1', t)
  await wait(200)
  a.shapes.get('t1').get('text').insert(0, 'A:')
  b.shapes.get('t1').get('text').insert(5, '!')
  await wait(200)
  const ta = a.shapes.get('t1').get('text').toString(), tb = b.shapes.get('t1').get('text').toString()
  assert(ta === tb && ta.includes('A:') && ta.includes('!'), `concurrent text edits merged ("${ta}")`)

  // Presence
  a.provider.awareness.setLocalStateField('user', { name: 'Alice', color: '#f00' })
  a.provider.awareness.setLocalStateField('cursor', { x: 5, y: 6 })
  await wait(200)
  const seen = b.provider.awareness.getStates().get(a.doc.clientID)
  assert(seen?.user?.name === 'Alice' && seen?.cursor?.x === 5, 'B sees A\'s cursor + name')
  a.provider.destroy()
  await wait(300)
  assert(!b.provider.awareness.getStates().has(a.doc.clientID), 'A\'s cursor removed after disconnect')

  b.provider.destroy()
  await wait(300) // let the server flush on last disconnect
  console.log('ROOM', room)
  process.exit(0)
} else {
  const c = client()
  await synced(c.provider)
  await wait(100)
  const r = c.shapes.get('r1')
  assert(r?.get('x') === 99 && r?.get('fill') === '#ff0000', 'rect restored from storage after server restart')
  assert(c.shapes.get('t1')?.get('text')?.toString().includes('A:'), 'text restored from storage')
  c.provider.destroy()
  process.exit(0)
}
