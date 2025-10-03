import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import SheetAccessGuard from './SheetAccessGuard'
import Shell from './layout/Shell'
import Sell from './pages/Sell'
import Gate from './pages/Gate'
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
      { index: true, element: <Shell><Gate><Sell /></Gate></Shell> },
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
