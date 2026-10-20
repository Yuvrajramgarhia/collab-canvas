import { useState } from 'react'
import { newId } from '../lib/doc'

export function Home({ onJoin }: { onJoin: (roomId: string) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const join = (e: React.FormEvent) => {
    e.preventDefault()
    // Accept a bare room id or a full /room/:id link.
    const id = code.trim().match(/(?:\/room\/)?([A-Za-z0-9_-]{1,64})\/?$/)?.[1]
    if (!id) return setError('Enter a room code or paste a room link.')
    onJoin(id)
  }

  return (
    <main className="home">
      <div className="home-card">
        <h1>Collab Canvas</h1>
        <p>A real-time whiteboard. Draw, sketch and write together. Share the link and everyone sees changes instantly.</p>
        <button className="primary-btn big" onClick={() => onJoin(newId(10))}>Create a new board</button>
        <div className="divider"><span>or join one</span></div>
        <form onSubmit={join} className="join-form">
          <input
            aria-label="Room code or link"
            placeholder="Room code or link"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError('') }}
          />
          <button className="panel-btn" type="submit">Join</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  )
}
