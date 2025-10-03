import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  hasError: boolean
  error?: Error | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Uncaught error in application', error, errorInfo)
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={containerStyle} role="alert">
          <h1 style={titleStyle}>Something went wrong</h1>
          <p style={messageStyle}>
            An unexpected error occurred. Please refresh the page or try again later.
          </p>
          <button type="button" onClick={this.handleReload} style={buttonStyle}>
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

const containerStyle: CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: '1.5rem',
}

const titleStyle: CSSProperties = {
  fontSize: '2rem',
  fontWeight: 600,
  margin: 0,
}

const messageStyle: CSSProperties = {
  fontSize: '1rem',
  maxWidth: '28rem',
  margin: 0,
}

const buttonStyle: CSSProperties = {
  border: 'none',
  borderRadius: '0.5rem',
  backgroundColor: '#2b6cb0',
  color: '#fff',
  padding: '0.75rem 1.5rem',
  fontSize: '1rem',
  fontWeight: 500,
  cursor: 'pointer',
}
