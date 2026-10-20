import { useEffect, useState } from 'react'
import type { UserInfo } from '../types'

export const USER_COLORS = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#0c8599', '#5c940d']
const ADJECTIVES = ['Swift', 'Brave', 'Calm', 'Clever', 'Bright', 'Lucky', 'Quiet', 'Witty', 'Bold', 'Sunny']
const ANIMALS = ['Otter', 'Falcon', 'Panda', 'Fox', 'Koala', 'Lynx', 'Heron', 'Tiger', 'Whale', 'Badger']
const KEY = 'collab-canvas:user'

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

function loadUser(): UserInfo {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const u = JSON.parse(raw)
      if (typeof u?.name === 'string' && typeof u?.color === 'string') return u
    }
  } catch {
    /* storage unavailable */
  }
  return { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(USER_COLORS) }
}

export function useUser(): [UserInfo, (u: UserInfo) => void] {
  const [user, setUser] = useState(loadUser)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(user))
    } catch {
      /* storage unavailable */
    }
  }, [user])
  return [user, setUser]
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'
