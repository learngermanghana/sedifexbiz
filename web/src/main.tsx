// web/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'

import App from './App'
import ShellLayout from './layout/ShellLayout'

import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Sell from './pages/Sell'
import Receive from './pages/Receive'
import Customers from './pages/Customers'
import ActivityFeed from './pages/ActivityFeed'
import CloseDay from './pages/CloseDay'
import Finance from './pages/Finance'
import Onboarding from './pages/Onboarding'
import AccountOverview from './pages/AccountOverview'
import StaffManagement from './pages/StaffManagement'
import { BillingVerifyPage } from './pages/BillingVerifyPage'
import Support from './pages/Support'

import { ToastProvider } from './components/ToastProvider'
import './App.css'

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        element: <ShellLayout />,
        children: [
          // Dashboard
          { index: true, element: <Dashboard /> },
          { path: 'dashboard', element: <Dashboard /> },

          // Core pages
          { path: 'products', element: <Products /> },
          { path: 'sell', element: <Sell /> },
          { path: 'receive', element: <Receive /> },
          { path: 'customers', element: <Customers /> },
          { path: 'activity', element: <ActivityFeed /> },

          // Finance & accounting
          { path: 'finance', element: <Finance /> },
          { path: 'close-day', element: <CloseDay /> },

          // Admin / settings
          { path: 'onboarding', element: <Onboarding /> },
          { path: 'staff', element: <StaffManagement /> },
          { path: 'account', element: <AccountOverview /> },
          { path: 'support', element: <Support /> },
        ],
      },

      // Billing verification lives outside Shell layout
      { path: 'billing/verify', element: <BillingVerifyPage /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </React.StrictMode>,
)
