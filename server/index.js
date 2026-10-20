import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import { createStore } from './store.js'
import { RoomManager, ROOM_ID_RE } from './rooms.js'

const PORT = Number(process.env.PORT) || 1234
const here = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.join(here, '..', 'client', 'dist')

const store = await createStore()
const rooms = new RoomManager(store)

const app = express()
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size, storage: store.kind }))

// In production, serve the built client (with SPA fallback for /room/:id).
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })

// WebSocket endpoint: /yjs/:roomId
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  const match = pathname.match(/^\/yjs\/([^/]+)$/)
  if (!match || !ROOM_ID_RE.test(match[1])) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.binaryType = 'arraybuffer'
    rooms.get(match[1]).addConnection(ws)
  })
})

server.listen(PORT, () => {
  console.log(`collab-canvas server on http://localhost:${PORT} (storage: ${store.kind})`)
})

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('Saving rooms before exit…')
  wss.clients.forEach((ws) => ws.close(1001, 'server shutting down'))
  await rooms.flushAll()
  await store.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
