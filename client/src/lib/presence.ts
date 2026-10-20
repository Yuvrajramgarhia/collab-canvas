import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import type { Peer } from '../types'

/** Everyone else in the room, from Yjs awareness (cursor + identity). */
export function usePeers(awareness: Awareness): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([])
  useEffect(() => {
    const read = () => {
      const out: Peer[] = []
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID || !state.user) return
        out.push({ clientId, user: state.user, cursor: state.cursor ?? null })
      })
      setPeers(out)
    }
    read()
    awareness.on('change', read)
    return () => awareness.off('change', read)
  }, [awareness])
  return peers
}
