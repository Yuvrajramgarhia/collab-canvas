import { useEffect, useState } from 'react'
import { Home } from './components/Home'
import { Room } from './components/Room'

const ROOM_PATH = /^\/room\/([A-Za-z0-9_-]{1,64})\/?$/

export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to: string) => {
    window.history.pushState(null, '', to)
    setPath(to)
  }
  const roomId = path.match(ROOM_PATH)?.[1]
  return roomId ? (
    <Room key={roomId} roomId={roomId} onLeave={() => navigate('/')} />
  ) : (
    <Home onJoin={(id) => navigate(`/room/${id}`)} />
  )
}
