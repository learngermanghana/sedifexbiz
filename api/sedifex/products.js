const PRODUCT_CACHE_FRESH_MS = 5 * 60 * 1000
const PRODUCT_CACHE_STALE_MS = 15 * 60 * 1000
const SUCCESS_CACHE_CONTROL = 'public, max-age=300, s-maxage=900, stale-while-revalidate=600'
const ERROR_CACHE_CONTROL = 'no-store'

let cachedProducts = null

function sendJson(res, status, payload, cacheControl = ERROR_CACHE_CONTROL) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', cacheControl)
  return res.status(status).json(payload)
}

function sendCatalogJson(res, payload) {
  return sendJson(res, 200, payload, SUCCESS_CACHE_CONTROL)
}

function sendStaleCatalogIfAvailable(res) {
  if (cachedProducts && Date.now() - cachedProducts.savedAt <= PRODUCT_CACHE_STALE_MS) {
    return sendCatalogJson(res, { ...cachedProducts.payload, cached: true, stale: true })
  }
  return null
}

function getCatalogEndpoint() {
  const endpoint = process.env.SEDIFEX_PRODUCTS_URL || process.env.SEDIFEX_CATALOG_URL
  return typeof endpoint === 'string' ? endpoint.trim() : ''
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  const endpoint = getCatalogEndpoint()
  if (!endpoint) {
    const staleResponse = sendStaleCatalogIfAvailable(res)
    if (staleResponse) return staleResponse
    return sendJson(res, 500, { ok: false, error: 'Sedifex catalog endpoint is not configured.' })
  }

  if (cachedProducts && Date.now() - cachedProducts.savedAt <= PRODUCT_CACHE_FRESH_MS) {
    return sendCatalogJson(res, { ...cachedProducts.payload, cached: true })
  }

  try {
    const upstreamResponse = await fetch(endpoint, { method: 'GET' })
    let payload = null

    try {
      payload = await upstreamResponse.json()
    } catch (error) {
      payload = null
    }

    if (!upstreamResponse.ok || payload?.ok === false) {
      const staleResponse = sendStaleCatalogIfAvailable(res)
      if (staleResponse) return staleResponse

      return sendJson(res, upstreamResponse.ok ? 502 : upstreamResponse.status, {
        ok: false,
        error: payload?.error || 'Sedifex catalog request failed.',
      })
    }

    const catalogPayload = { ...payload, ok: payload?.ok !== false }
    cachedProducts = {
      savedAt: Date.now(),
      payload: catalogPayload,
    }

    return sendCatalogJson(res, { ...catalogPayload, cached: false })
  } catch (error) {
    const staleResponse = sendStaleCatalogIfAvailable(res)
    if (staleResponse) return staleResponse

    return sendJson(res, 502, { ok: false, error: 'Sedifex catalog request failed.' })
  }
}
