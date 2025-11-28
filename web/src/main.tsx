import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import ShellLayout from './layout/ShellLayout'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Sell from './pages/Sell'
import Receive from './pages/Receive'
import CloseDay from './pages/CloseDay'
import Customers from './pages/Customers'
import ActivityFeed from './pages/ActivityFeed'
import Onboarding from './pages/Onboarding'
import AccountOverview from './pages/AccountOverview'
import StaffManagement from './pages/StaffManagement'
import { BillingVerifyPage } from './pages/BillingVerifyPage'
import Support from './pages/Support'
import Finance from './pages/Finance'
import Expenses from './pages/Expenses'
import ResetPassword from './pages/ResetPassword'
import { ToastProvider } from './components/ToastProvider'

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        element: <ShellLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'products', element: <Products /> },
          { path: 'sell', element: <Sell /> },
          { path: 'receive', element: <Receive /> },
          { path: 'customers', element: <Customers /> },
          { path: 'activity', element: <ActivityFeed /> },

          // ✅ Finance main page
          { path: 'finance', element: <Finance /> },

          // ✅ Expenses page (matches <Link to="/expenses">)
          { path: 'expenses', element: <Expenses /> },

          // Close Day route for the quick link
          { path: 'close-day', element: <CloseDay /> },

          { path: 'onboarding', element: <Onboarding /> },
          { path: 'staff', element: <StaffManagement /> },
          { path: 'account', element: <AccountOverview /> },
          { path: 'support', element: <Support /> },
        ],
      },

      // 🔓 Public routes (outside ShellLayout)
      { path: 'reset-password', element: <ResetPassword /> },
      { path: 'billing/verify', element: <BillingVerifyPage /> },
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
