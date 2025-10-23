// web/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, redirect } from 'react-router-dom'
import App from './App'
import Shell from './layout/Shell'
import Products from './pages/Products'
import { ToastProvider } from './components/ToastProvider'
import { WorkspaceSelectProvider } from './hooks/useWorkspaceSelect'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      // Default to products list
      { index: true, element: <Shell><Products /></Shell> },

      // Product-only route
      { path: 'products', element: <Shell><Products /></Shell> },
    ],
  },

  // Catch-all -> products
  { path: '*', loader: () => redirect('/products') },
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
