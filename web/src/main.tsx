import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

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
import AiAdvisor from './pages/AiAdvisor'

// ✅ NEW: public receipt page used by QR/share
import ReceiptView from './pages/ReceiptView'

import PrivacyPage from './pages/legal/PrivacyPage'
import CookiesPage from './pages/legal/CookiesPage'
import RefundPage from './pages/legal/RefundPage'

import { ToastProvider } from './components/ToastProvider'

const router = createBrowserRouter([
  // Public receipt route bypasses App-level redirects
  { path: '/receipt/:saleId', element: <ReceiptView /> },

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

          // Finance
          { path: 'finance', element: <Finance /> },
          { path: 'expenses', element: <Expenses /> },

          // Close day
          { path: 'close-day', element: <CloseDay /> },

          // Other authenticated pages
          { path: 'onboarding', element: <Onboarding /> },
          { path: 'staff', element: <StaffManagement /> },
          { path: 'account', element: <AccountOverview /> },
          { path: 'support', element: <Support /> },
          { path: 'advisor', element: <AiAdvisor /> },
        ],
      },

      // Public routes (still under App)
      { path: 'reset-password', element: <ResetPassword /> },
      { path: 'verify-email', element: <VerifyEmail /> },
      { path: 'billing/verify', element: <BillingVerifyPage /> },

      // Legal pages
      { path: 'legal/privacy', element: <PrivacyPage /> },
      { path: 'legal/cookies', element: <CookiesPage /> },
      { path: 'legal/refund', element: <RefundPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'cookies', element: <CookiesPage /> },
      { path: 'refund', element: <RefundPage /> },
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
