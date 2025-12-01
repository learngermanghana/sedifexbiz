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
import Logi from './pages/Logi'
import Onboarding from './pages/Onboarding'
import AccountOverview from './pages/AccountOverview'
import StaffManagement from './pages/StaffManagement'
import { BillingVerifyPage } from './pages/BillingVerifyPage'
import Support from './pages/Support'
import Finance from './pages/Finance'
import Expenses from './pages/Expenses'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'

import PrivacyPage from './pages/legal/PrivacyPage'
import CookiesPage from './pages/legal/CookiesPage'
import RefundPage from './pages/legal/RefundPage'

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
          { path: 'logi', element: <Logi /> },

          { path: 'finance', element: <Finance /> },
          { path: 'expenses', element: <Expenses /> },
          { path: 'close-day', element: <CloseDay /> },

          { path: 'onboarding', element: <Onboarding /> },
          { path: 'staff', element: <StaffManagement /> },
          { path: 'account', element: <AccountOverview /> },
          { path: 'support', element: <Support /> },
        ],
      },

      // Public (non-authenticated) routes
      { path: 'reset-password', element: <ResetPassword /> },
      { path: 'verify-email', element: <VerifyEmail /> },
      { path: 'billing/verify', element: <BillingVerifyPage /> },

      // ✅ Legal pages
      { path: 'legal/privacy', element: <PrivacyPage /> },
      { path: 'legal/cookies', element: <CookiesPage /> },
      { path: 'legal/refund', element: <RefundPage /> },
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
