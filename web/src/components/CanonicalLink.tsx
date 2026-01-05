import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SITE_ORIGIN = 'https://sedifex.com'
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'ttclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
])
const PATH_CANONICAL_OVERRIDES: Record<string, string> = {
  '/legal/privacy': '/privacy',
  '/legal/cookies': '/cookies',
  '/legal/refund': '/refund',
}

/**
 * Ensures each rendered route declares a canonical URL so crawlers index the
 * correct version of the page and ignore hash-based or redirected variants.
 */
export function CanonicalLink({ baseUrl = SITE_ORIGIN }: { baseUrl?: string }) {
  const location = useLocation()

  useEffect(() => {
    const canonicalPath = PATH_CANONICAL_OVERRIDES[location.pathname] ?? location.pathname
    const searchParams = new URLSearchParams(location.search || '')
    TRACKING_PARAMS.forEach(param => searchParams.delete(param))
    const searchSuffix = searchParams.toString()
    const canonicalUrl = new URL(
      `${canonicalPath}${searchSuffix ? `?${searchSuffix}` : ''}` || '/',
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
