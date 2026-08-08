import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ProductsServiceFirst from './ProductsServiceFirst'
import './ProductsWorkspace.css'

function markDescriptionFields(root: HTMLDivElement | null) {
  if (!root) return

  root.querySelectorAll<HTMLElement>('.products-page__list-field').forEach(field => {
    const label = field.querySelector<HTMLElement>('.field__label')
    if (label?.textContent?.trim() !== 'Description') return

    field.classList.add('products-workspace__description-field')
    field.tabIndex = 0
    field.setAttribute('role', 'button')
    field.setAttribute('aria-expanded', field.classList.contains('is-expanded') ? 'true' : 'false')
    field.setAttribute('aria-label', 'Show or hide product description')
  })
}

function toggleDescriptionField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const field = target.closest<HTMLElement>('.products-workspace__description-field')
  if (!field) return false

  const expanded = field.classList.toggle('is-expanded')
  field.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  return true
}

export default function ProductsWorkspace() {
  const location = useLocation()
  const rootRef = useRef<HTMLDivElement>(null)
  const isAddPage = location.pathname === '/products/new'

  useEffect(() => {
    if (isAddPage) return

    markDescriptionFields(rootRef.current)
    const observer = new MutationObserver(() => markDescriptionFields(rootRef.current))
    if (rootRef.current) observer.observe(rootRef.current, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [isAddPage])

  return (
    <div
      ref={rootRef}
      className={`products-workspace ${isAddPage ? 'products-workspace--add' : 'products-workspace--list'}`}
      onClick={event => {
        if (!isAddPage) toggleDescriptionField(event.target)
      }}
      onKeyDown={event => {
        if (isAddPage || (event.key !== 'Enter' && event.key !== ' ')) return
        if (toggleDescriptionField(event.target)) event.preventDefault()
      }}
    >
      <nav className="products-workspace__nav" aria-label="Products navigation">
        <Link
          to="/products"
          className={`products-workspace__nav-link ${!isAddPage ? 'is-active' : ''}`}
          aria-current={!isAddPage ? 'page' : undefined}
        >
          All products
        </Link>
        <Link
          to="/products/new"
          className={`products-workspace__nav-link products-workspace__nav-link--primary ${isAddPage ? 'is-active' : ''}`}
          aria-current={isAddPage ? 'page' : undefined}
        >
          + Add item
        </Link>
      </nav>

      <ProductsServiceFirst key={isAddPage ? 'products-add' : 'products-list'} />
    </div>
  )
}
