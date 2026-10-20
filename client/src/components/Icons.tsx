import type { ReactNode } from 'react'

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const Icons = {
  select: <Svg><path d="M5 3l14 8-6 1.5L10 19z" /></Svg>,
  hand: <Svg><path d="M7 11V6a1.5 1.5 0 013 0v5M10 10V4.5a1.5 1.5 0 013 0V10M13 10V5.5a1.5 1.5 0 013 0V12M16 9.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a7 7 0 01-5.6-2.8L3.7 15a1.5 1.5 0 012.3-1.9L7 14" /></Svg>,
  pen: <Svg><path d="M4 20c4-1 5-5 8-8s6-4 8-8" /></Svg>,
  rect: <Svg><rect x="4" y="6" width="16" height="12" rx="1.5" /></Svg>,
  ellipse: <Svg><ellipse cx="12" cy="12" rx="8.5" ry="6.5" /></Svg>,
  text: <Svg><path d="M5 6V4h14v2M12 4v16M9 20h6" /></Svg>,
  undo: <Svg><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></Svg>,
  redo: <Svg><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></Svg>,
  trash: <Svg><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>,
  front: <Svg><rect x="8" y="8" width="12" height="12" rx="1" fill="currentColor" opacity=".25" /><path d="M4 16V4h12" /></Svg>,
  back: <Svg><rect x="4" y="4" width="12" height="12" rx="1" fill="currentColor" opacity=".25" /><path d="M20 8v12H8" /></Svg>,
  duplicate: <Svg><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></Svg>,
  download: <Svg><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>,
  link: <Svg><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></Svg>,
  home: <Svg><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /></Svg>,
}
