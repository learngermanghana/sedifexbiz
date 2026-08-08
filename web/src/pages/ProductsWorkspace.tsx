import { Link, useLocation } from 'react-router-dom'
import ProductsServiceFirst from './ProductsServiceFirst'
import './ProductsWorkspace.css'

export default function ProductsWorkspace() {
  const location = useLocation()
  const isAddPage = location.pathname === '/products/new'

  return (
    <div className={`products-workspace ${isAddPage ? 'products-workspace--add' : 'products-workspace--list'}`}>
      <nav className="products-workspace__nav" aria-label="Products navigation">
        <Link
          to="/products"
          className={`products-workspace__nav-link ${!isAddPage ? 'is-active' : ''}`}
          aria-current={!isAddPage ? 'page' : undefined}
        >
          All items
        </Link>
        <Link
          to="/products/new"
          className={`products-workspace__nav-link products-workspace__nav-link--primary ${isAddPage ? 'is-active' : ''}`}
          aria-current={isAddPage ? 'page' : undefined}
        >
          + Add item
        </Link>
      </nav>

      <ProductsServiceFirst />
    </div>
  )
}
