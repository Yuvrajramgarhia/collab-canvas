export type Tool = 'select' | 'hand' | 'pen' | 'rect' | 'ellipse' | 'text'
export type ShapeType = 'pen' | 'rect' | 'ellipse' | 'text'

export interface Shape {
  id: string
  type: ShapeType
  x: number
  y: number
  rotation: number
  /** Stacking order; ties broken by id so every client agrees. */
  z: number
  stroke: string
  fill: string
  strokeWidth: number
  // rect
  width?: number
  height?: number
  // ellipse (x, y is the center)
  radiusX?: number
  radiusY?: number
  // pen (relative to x, y)
  points?: number[]
  // text (color = stroke, wraps at width)
  text?: string
  fontSize?: number
}

export interface Style {
  stroke: string
  fill: string
  strokeWidth: number
}

export interface UserInfo {
  name: string
  color: string
}

export interface Peer {
  clientId: number
  user: UserInfo
  cursor: { x: number; y: number } | null
}

export interface View {
  x: number
  y: number
  scale: number
}
