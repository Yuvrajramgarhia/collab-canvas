# Collab Canvas

A real-time collaborative whiteboard: React + Konva on the client, and a Node WebSocket server that syncs a
[Yjs](https://yjs.dev) CRDT document per room, with auto-save to PostgreSQL or local files.

## Quick start

```bash
npm install
npm run dev            # server on :1234, client on http://localhost:5173
```

Open http://localhost:5173, click **Create a new board**, and share the `/room/:roomId` link. Open it in a
second tab or on another device to see live cursors and edits.

Production: `npm run build && npm start` serves the built client and the WebSocket on one port (`PORT`, default 1234).

### Persistence

| Setting | Storage |
|---|---|
| `DATABASE_URL` set | PostgreSQL table `rooms(id, state bytea, updated_at)`, created automatically |
| not set (default) | `server/data/<roomId>.bin` (override the folder with `DATA_DIR`) |

`docker compose up -d` starts a local Postgres (see `docker-compose.yml`).

## Features

**Drawing:** freehand pen, rectangles, ellipses (Shift = square/circle), text blocks (double-click to edit, wraps at width).
**Canvas:** infinite pan (drag with the hand tool, Space+drag, middle-mouse, or scroll) and zoom (⌘/Ctrl+scroll or pinch, toward the cursor).
**Objects:** select (Shift-click for multi-select), drag, resize/rotate handles, delete, duplicate, bring to front or send to back, stroke/fill/width.
**Collaboration:** rooms by URL, live cursors with names and colors, presence avatars, and editable display names.
**History:** per-user undo/redo. It only reverts *your* changes, never a collaborator's.
**Export/import:** PNG (2× resolution, white background), SVG (vector), JSON (re-importable).

### Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| V / 1 | Select | ⌘Z / ⌘⇧Z / ⌘Y | Undo / redo |
| H / 2 | Pan | Del / ⌫ | Delete selection |
| P / 3 | Draw | ⌘D | Duplicate |
| R / 4 | Rectangle | ⌘A | Select all |
| O / 5 | Ellipse | ] / [ | Bring to front / send to back |
| T / 6 | Text | ⌘+ / ⌘− / ⌘0 | Zoom in / out / reset |
| Space (hold) | Pan | Esc | Deselect, or finish text |

## Architecture

```
client/  Vite + React + react-konva
  lib/doc.ts        Yjs document model + useShapes() hook
  lib/presence.ts   awareness → remote cursors
  lib/export.ts     PNG / SVG / JSON export, JSON import
  components/Whiteboard.tsx   stage, tools, pan/zoom, transformer, text editor
server/  Node + ws + y-protocols
  rooms.js          one Y.Doc per room, sync + awareness protocol, debounced save
  store.js          Postgres or file snapshot store
```

**Sync model (CRDT).** Each room is one `Y.Doc` containing `shapes: Y.Map<id, Y.Map>`. Each shape is its own
map, so concurrent edits to different properties all survive: one user moves a shape while another recolors it, and
both changes apply. Pen `points` is a `Y.Array` that streams incrementally while you draw. Text is a `Y.Text`, so two
people typing in the same block merge at the character level. Z-order is a numeric `z` with ties broken by id, so every
client agrees on stacking.

**Client-side prediction.** Edits apply to the local `Y.Doc` first and render immediately; Yjs ships the delta to
the server in the background. If the connection drops, you keep working, and the edits merge once you reconnect.

**Throttling.** Cursor positions are sent ~30×/s, drag positions ~30×/s, and stroke/shape geometry while drawing
≤60×/s. Untouched shapes keep object identity, so memoized Konva nodes skip re-rendering.

**Auto-save.** The server debounces saves by 1 s (and saves at least every 5 s during continuous editing),
flushes when the last user leaves a room, and flushes everything on SIGINT/SIGTERM. A room is unloaded from memory
once it's empty and saved.

**Protocol.** The server speaks the standard y-websocket wire protocol, so the stock `WebsocketProvider` is the
client and the server stays ~200 lines with no framework.

## Tests

```bash
npm start &            # or npm run dev
npm run test:sync      # two headless clients: shape sync, concurrent-edit merging, presence
npm run test:sync -- myroom read   # after restarting the server: verifies the room was restored from storage
```
