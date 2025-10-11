// web/src/pages/BillingThanks.tsx
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { markPaid } from '../lib/paid'

export default function BillingThanks() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    // e.g. /billing/thanks?plan=starter
    const plan = (params.get('plan') || 'starter').toLowerCase()
    markPaid(plan)
    // small pause so the user sees the message (optional)
    const t = setTimeout(() => navigate('/auth', { replace: true }), 1200)
    return () => clearTimeout(t)
  }, [navigate, params])

  return (
    <main style={{ padding: 24 }}>
      <h1>Thanks! Payment received</h1>
      <p>Redirecting you to create your account…</p>
    </main>
  )
}
