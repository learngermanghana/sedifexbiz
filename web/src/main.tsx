import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import Shell from './layout/Shell'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Sell from './pages/Sell'
import Receive from './pages/Receive'
import CloseDay from './pages/CloseDay'
import Reports from './pages/Reports'
import Customers from './pages/Customers'
import Onboarding from './pages/Onboarding'
import AccountOverview from './pages/AccountOverview'
import StaffManagement from './pages/StaffManagement'
import { BillingVerifyPage } from './pages/BillingVerifyPage'
import Support from './pages/Support'
import { ToastProvider } from './components/ToastProvider'

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Shell><Dashboard /></Shell> },
      { path: 'dashboard', element: <Shell><Dashboard /></Shell> },
      { path: 'products',  element: <Shell><Products /></Shell> },
      { path: 'sell',      element: <Shell><Sell /></Shell> },
      { path: 'receive',   element: <Shell><Receive /></Shell> },
      { path: 'customers', element: <Shell><Customers /></Shell> },
      { path: 'close-day', element: <Shell><CloseDay /></Shell> },
      { path: 'reports/daily-summary', element: <Shell><Reports /></Shell> },
      { path: 'onboarding', element: <Shell><Onboarding /></Shell> },
      { path: 'staff', element: <Shell><StaffManagement /></Shell> },
      { path: 'account',   element: <Shell><AccountOverview /></Shell> },
      { path: 'billing/verify', element: <BillingVerifyPage /> },
      { path: 'support', element: <Shell><Support /></Shell> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </React.StrictMode>,
)
