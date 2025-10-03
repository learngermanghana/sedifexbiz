import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

type ToastTone = 'success' | 'error' | 'info'

type ToastOptions = {
  message: string
  tone?: ToastTone
  duration?: number
}

type ToastRecord = Required<ToastOptions> & { id: number }

type ToastContextValue = {
  publish: (options: ToastOptions) => void
  dismiss: (id: number) => void
}

const DEFAULT_DURATION = 5000

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const timersRef = useRef(new Map<number, number>())
  const idRef = useRef(0)

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timeoutId => {
        window.clearTimeout(timeoutId)
      })
      timersRef.current.clear()
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id))
    const timeoutId = timersRef.current.get(id)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      timersRef.current.delete(id)
    }
  }, [])

  const publish = useCallback(
    ({ message, tone = 'info', duration = DEFAULT_DURATION }: ToastOptions) => {
      const trimmed = message.trim()
      if (!trimmed) return

      const id = ++idRef.current
      const record: ToastRecord = { id, message: trimmed, tone, duration }
      setToasts(current => [...current, record])

      if (duration > 0) {
        const timeoutId = window.setTimeout(() => {
          dismiss(id)
        }, duration)
        timersRef.current.set(id, timeoutId)
      }
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(() => ({ publish, dismiss }), [publish, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={containerStyle} aria-live="polite" aria-atomic="false">
        {toasts.map(toast => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            style={{ ...toastStyle, ...toneStyles[toast.tone] }}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  top: '1rem',
  right: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  zIndex: 1100,
  pointerEvents: 'none',
}

const toastStyle: CSSProperties = {
  pointerEvents: 'auto',
  border: 'none',
  borderRadius: '0.5rem',
  padding: '0.75rem 1rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#fff',
  backgroundColor: '#333',
  boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
  cursor: 'pointer',
  textAlign: 'left',
}

const toneStyles: Record<ToastTone, CSSProperties> = {
  success: { backgroundColor: '#1b873f' },
  error: { backgroundColor: '#c53030' },
  info: { backgroundColor: '#2b6cb0' },
}
