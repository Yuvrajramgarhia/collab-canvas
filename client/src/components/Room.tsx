import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { useUser } from '../lib/user'
import { Whiteboard } from './Whiteboard'

const WS_URL =
  import.meta.env.VITE_WS_URL ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/yjs`

export function Room({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const [user, setUser] = useUser()
  const [conn, setConn] = useState<{ doc: Y.Doc; provider: WebsocketProvider } | null>(null)
  const [status, setStatus] = useState('connecting')
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(WS_URL, roomId, doc)
    provider.on('status', (e: { status: string }) => setStatus(e.status))
    provider.on('sync', (isSynced: boolean) => setSynced(isSynced))
    setConn({ doc, provider })
    document.title = `Room ${roomId} · Collab Canvas`
    return () => {
      provider.destroy()
      doc.destroy()
      setConn(null)
      document.title = 'Collab Canvas'
    }
  }, [roomId])

  if (!conn) return null
  return (
    <Whiteboard
      doc={conn.doc}
      awareness={conn.provider.awareness}
      roomId={roomId}
      status={status}
      synced={synced}
      user={user}
      onUserChange={setUser}
      onLeave={onLeave}
    />
  )
}
