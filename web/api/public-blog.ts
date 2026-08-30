import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from './_firebase-admin.js'

const LIST_CONTENT_PREVIEW_LENGTH = 600
const BROWSER_CACHE_SECONDS = 60
const VERCEL_CDN_CACHE_SECONDS = 300
const STALE_WHILE_REVALIDATE_SECONDS = 86_400

function setPublicCacheHeaders(res: VercelResponse) {
  res.setHeader(
    'Cache-Control',
    `public, max-age=${BROWSER_CACHE_SECONDS}, stale-while-revalidate=${VERCEL_CDN_CACHE_SECONDS}`,
  )
  res.setHeader(
    'Vercel-CDN-Cache-Control',
    `public, max-age=${VERCEL_CDN_CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
  )
}

function compactListContent(value: unknown): string {
  if (typeof value !== 'string') return ''
  const content = value.trim()
  if (content.length <= LIST_CONTENT_PREVIEW_LENGTH) return content
  return `${content.slice(0, LIST_CONTENT_PREVIEW_LENGTH).trimEnd()}…`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const storeId = typeof req.query.storeId === 'string' ? req.query.storeId.trim() : ''
  if (!storeId) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(400).json({ error: 'storeId is required' })
  }

  const postSlug = typeof req.query.slug === 'string' ? req.query.slug.trim() : ''
  const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : ''
  const isDetailRequest = Boolean(postSlug)

  const firestore = db()
  let query = firestore.collection('blogPosts').where('storeId', '==', storeId)

  const now = new Date()

  if (isDetailRequest) {
    query = query.where('slug', '==', postSlug).limit(1)
  } else {
    query = query.orderBy('updatedAt', 'desc').limit(50)
  }

  const snap = await query.get()
  let items = snap.docs
    .map(doc => {
      const data = doc.data()
      const status = data.status ?? 'draft'
      const publishAt = data.publishAt?.toDate ? data.publishAt.toDate() : null
      const isVisible = status === 'published' || (status === 'scheduled' && publishAt && publishAt <= now)
      if (!isVisible) return null

      const content = typeof data.content === 'string' ? data.content : ''

      return {
        id: doc.id,
        title: data.title ?? '',
        slug: data.slug ?? '',
        excerpt: data.excerpt ?? null,
        content: isDetailRequest ? content : compactListContent(content),
        linkUrl: data.linkUrl ?? null,
        imageUrl: data.imageUrl ?? null,
        metaTitle: data.metaTitle ?? null,
        metaDescription: data.metaDescription ?? null,
        canonicalUrl: data.canonicalUrl ?? null,
        ogImage: data.ogImage ?? null,
        tags: Array.isArray(data.tags) ? data.tags.filter((item: unknown) => typeof item === 'string') : [],
        publishedAt: data.publishedAt?.toDate ? data.publishedAt.toDate().toISOString() : null,
      }
    })
    .filter(Boolean)

  if (tag) {
    items = items.filter(item => (item?.tags ?? []).includes(tag))
  }

  setPublicCacheHeaders(res)
  return res.status(200).json({ items })
}
