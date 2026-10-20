import { createRoot } from 'react-dom/client'
import Konva from 'konva'
import App from './App'
import './styles.css'

// Handy for debugging/QA in dev: window.Konva.stages[0]
if (import.meta.env.DEV) (window as unknown as { Konva: typeof Konva }).Konva = Konva

// No <StrictMode>: its double-mounted effects would open two WebSocket providers per room in dev.
createRoot(document.getElementById('root')!).render(<App />)
