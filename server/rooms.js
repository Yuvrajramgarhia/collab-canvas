import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MSG_SYNC = 0
const MSG_AWARENESS = 1

const SAVE_DEBOUNCE_MS = 1000
const SAVE_MAX_WAIT_MS = 5000
const PING_INTERVAL_MS = 30000

export const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * One shared Yjs document per room. Speaks the standard y-websocket wire
 * protocol (sync + awareness), so the stock `WebsocketProvider` works as client.
 */
class Room {
  constructor(id, store, onEmpty) {
    this.id = id
    this.store = store
    this.onEmpty = onEmpty
    this.doc = new Y.Doc()
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null) // the server itself has no presence
    /** @type {Map<import('ws').WebSocket, Set<number>>} ws -> awareness client ids it controls */
    this.conns = new Map()
    this.saveTimer = null
    this.firstDirtyAt = 0
    this.saving = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    const state = await this.store.load(this.id)
    if (state) Y.applyUpdate(this.doc, state, 'load')

    this.doc.on('update', (update) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MSG_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      this.broadcast(encoding.toUint8Array(encoder))
      this.scheduleSave()
    })

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const ids = this.conns.get(origin)
      if (ids) {
        added.forEach((id) => ids.add(id))
        removed.forEach((id) => ids.delete(id))
      }
      const changed = added.concat(updated, removed)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MSG_AWARENESS)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      this.broadcast(encoding.toUint8Array(encoder))
    })
  }

  /** Debounced auto-save, but never more than SAVE_MAX_WAIT_MS behind during continuous edits. */
  scheduleSave() {
    const now = Date.now()
    if (!this.saveTimer) this.firstDirtyAt = now
    clearTimeout(this.saveTimer)
    const wait = Math.min(SAVE_DEBOUNCE_MS, Math.max(0, this.firstDirtyAt + SAVE_MAX_WAIT_MS - now))
    this.saveTimer = setTimeout(() => this.save(), wait)
  }

  save() {
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    // Chain saves so two writes for the same room never race.
    this.saving = this.saving
      .then(() => this.store.save(this.id, Y.encodeStateAsUpdate(this.doc)))
      .catch((err) => console.error(`[room ${this.id}] save failed:`, err))
    return this.saving
  }

  get dirty() {
    return this.saveTimer !== null
  }

  broadcast(message) {
    for (const ws of this.conns.keys()) send(ws, message)
  }

  async addConnection(ws) {
    // Queue messages until the snapshot has loaded, preserving order.
    const queue = []
    let loaded = false
    ws.on('message', (data) => (loaded ? this.handleMessage(ws, data) : queue.push(data)))
    ws.on('close', () => this.removeConnection(ws))

    let alive = true
    ws.on('pong', () => (alive = true))
    const ping = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      ws.ping()
    }, PING_INTERVAL_MS)
    ws.once('close', () => clearInterval(ping))

    try {
      await this.ready
    } catch (err) {
      console.error(`[room ${this.id}] load failed:`, err)
      ws.close(1011, 'failed to load room')
      return
    }
    if (ws.readyState !== ws.OPEN) return
    this.conns.set(ws, new Set())

    // Start the sync handshake.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    send(ws, encoding.toUint8Array(encoder))

    const states = this.awareness.getStates()
    if (states.size > 0) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]))
      send(ws, encoding.toUint8Array(enc))
    }

    loaded = true
    queue.forEach((data) => this.handleMessage(ws, data))
  }

  handleMessage(ws, data) {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data))
      const type = decoding.readVarUint(decoder)
      if (type === MSG_SYNC) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MSG_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws)
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder))
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws)
      }
    } catch (err) {
      console.error(`[room ${this.id}] bad message:`, err)
    }
  }

  removeConnection(ws) {
    const ids = this.conns.get(ws)
    if (!ids) return
    this.conns.delete(ws)
    awarenessProtocol.removeAwarenessStates(this.awareness, [...ids], null)
    if (this.conns.size === 0) this.onEmpty(this)
  }

  destroy() {
    this.awareness.destroy()
    this.doc.destroy()
  }
}

function send(ws, message) {
  if (ws.readyState !== ws.OPEN) return
  ws.send(message, (err) => err && ws.close())
}

export class RoomManager {
  constructor(store) {
    this.store = store
    /** @type {Map<string, Room>} */
    this.rooms = new Map()
  }

  get(id) {
    let room = this.rooms.get(id)
    if (!room) {
      room = new Room(id, this.store, (r) => this.release(r))
      this.rooms.set(id, room)
    }
    return room
  }

  /** Last client left: flush to storage, then unload (unless someone rejoined meanwhile). */
  async release(room) {
    if (room.dirty) await room.save()
    else await room.saving
    if (room.conns.size === 0 && this.rooms.get(room.id) === room) {
      this.rooms.delete(room.id)
      room.destroy()
    }
  }

  async flushAll() {
    await Promise.all([...this.rooms.values()].map((r) => (r.dirty ? r.save() : r.saving)))
  }
}
