import React from 'react'
import ReactDOM from 'react-dom/client'
import { Navigate, createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import SheetAccessGuard from './SheetAccessGuard'
import Shell from './layout/Shell'
import Sell from './pages/Sell'
import { ToastProvider } from './components/ToastProvider'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { ActiveStoreProvider } from './context/ActiveStoreProvider'

const router = createHashRouter([
  {
    path: '/',
    element: (
      <SheetAccessGuard>
        <App />
      </SheetAccessGuard>
    ),
    children: [
      { index: true, element: <Navigate to="sell" replace /> },
      { path: 'sell', element: <Shell><Sell /></Shell> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <ActiveStoreProvider>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </ActiveStoreProvider>
    </ToastProvider>
  </React.StrictMode>,
)
