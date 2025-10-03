import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import SheetAccessGuard from './SheetAccessGuard'
import Shell from './layout/Shell'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Sell from './pages/Sell'
import Receive from './pages/Receive'
import CloseDay from './pages/CloseDay'
import Customers from './pages/Customers'
import Today from './pages/Today'
import AccountOverview from './pages/AccountOverview'
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
      { index: true, element: <Shell><Gate><Dashboard /></Gate></Shell> },
      { path: 'today',    element: <Shell><Gate><Today /></Gate></Shell> },
      { path: 'products',  element: <Shell><Gate><Products /></Gate></Shell> },
      { path: 'sell',      element: <Shell><Gate><Sell /></Gate></Shell> },
      { path: 'receive',   element: <Shell><Gate><Receive /></Gate></Shell> },
      { path: 'customers', element: <Shell><Gate><Customers /></Gate></Shell> },
      { path: 'close-day', element: <Shell><Gate><CloseDay /></Gate></Shell> },
      { path: 'account',   element: <Shell><Gate><AccountOverview /></Gate></Shell> },
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
