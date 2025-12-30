import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SITE_ORIGIN = 'https://sedifex.com'

/**
 * Ensures each rendered route declares a canonical URL so crawlers index the
 * correct version of the page and ignore hash-based or redirected variants.
 */
export function CanonicalLink({ baseUrl = SITE_ORIGIN }: { baseUrl?: string }) {
  const location = useLocation()

  useEffect(() => {
    const canonicalUrl = new URL(
      `${location.pathname}${location.search}` || '/',
      baseUrl,
    ).toString()

    let linkEl = document.querySelector("link[rel='canonical']")
    if (!linkEl) {
      linkEl = document.createElement('link')
      linkEl.setAttribute('rel', 'canonical')
      document.head.appendChild(linkEl)
    }

    linkEl.setAttribute('href', canonicalUrl)
  }, [baseUrl, location.pathname, location.search])

  return null
}
