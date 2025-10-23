// web/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, redirect } from 'react-router-dom'
import App from './App'
import Shell from './layout/Shell'
import Products from './pages/Products'
import ProductNew from './pages/ProductNew'
import ProductEdit from './pages/ProductEdit'
import { ToastProvider } from './components/ToastProvider'
import { WorkspaceSelectProvider } from './hooks/useWorkspaceSelect'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      // Default to products list
      { index: true, element: <Shell><Products /></Shell> },

      // Product-only routes
      { path: 'products', element: <Shell><Products /></Shell> },
      { path: 'products/new', element: <Shell><ProductNew /></Shell> },
      { path: 'products/:id', element: <Shell><ProductEdit /></Shell> },
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
