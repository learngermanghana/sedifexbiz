import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, redirect } from 'react-router-dom'
import App from './App'
import Shell from './layout/Shell'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Sell from './pages/Sell'
import Receive from './pages/Receive'
import CloseDay from './pages/CloseDay'
import Customers from './pages/Customers'
import Onboarding from './pages/Onboarding'
import AccountOverview from './pages/AccountOverview'
import AuthScreen from './pages/AuthScreen'
import BillingThanks from './pages/BillingThanks'
import { ToastProvider } from './components/ToastProvider'
import { WorkspaceSelectProvider } from './hooks/useWorkspaceSelect'

const router = createBrowserRouter([
  // Public, standalone screens
  { path: '/auth', element: <AuthScreen /> },
  { path: '/billing/thanks', element: <BillingThanks /> },

  // App shell with authenticated pages nested
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Shell><Dashboard /></Shell> },
      { path: 'products',  element: <Shell><Products /></Shell> },
      { path: 'sell',      element: <Shell><Sell /></Shell> },
      { path: 'receive',   element: <Shell><Receive /></Shell> },
      { path: 'customers', element: <Shell><Customers /></Shell> },
      { path: 'close-day', element: <Shell><CloseDay /></Shell> },
      { path: 'onboarding', element: <Shell><Onboarding /></Shell> },
      { path: 'account',   element: <Shell><AccountOverview /></Shell> },
    ],
  },

  // Catch-all -> home
  { path: '*', loader: () => redirect('/') },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceSelectProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </WorkspaceSelectProvider>
  </React.StrictMode>,
)
