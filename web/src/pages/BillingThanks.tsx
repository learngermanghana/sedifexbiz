import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useToast } from '../components/ToastProvider'

export default function BillingThanks() {
  const [search] = useSearchParams()
  const reference = search.get('reference') || ''
  const [state, setState] = useState<'checking'|'ok'|'fail'>('checking')
  const navigate = useNavigate()
  const { publish } = useToast()

  useEffect(() => {
    if (!reference) {
      setState('fail')
      publish({ tone: 'error', message: 'Missing payment reference.' })
      return
    }

    ;(async () => {
      try {
        const url = `https://us-central1-sedifex-ac2b0.cloudfunctions.net/confirmPayment?reference=${encodeURIComponent(reference)}`
        const resp = await fetch(url, { method: 'GET' })
        const json = await resp.json()
        if (json?.ok) {
          // Persist a short-lived flag so /auth will allow signup
          localStorage.setItem('sfx.billing.paidRef', reference)
          if (json.planId) localStorage.setItem('sfx.billing.planId', json.planId)
          if (json.email)  localStorage.setItem('sfx.billing.email', json.email)

          setState('ok')
          publish({ tone: 'success', message: 'Payment confirmed. You can now create your account.' })
          navigate('/auth?mode=sign-up', { replace: true })
        } else {
          setState('fail')
          publish({ tone: 'error', message: 'We could not confirm your payment yet.' })
        }
      } catch (e: any) {
        setState('fail')
        publish({ tone: 'error', message: e?.message || 'Network error confirming payment' })
      }
    })()
  }, [navigate, publish, reference])

  return (
    <main className="app">
      <div className="app__card">
        {state === 'checking' && <p>Confirming your payment…</p>}
        {state === 'ok' && <p>Payment confirmed. Redirecting…</p>}
        {state === 'fail' && (
          <>
            <p>We couldn’t confirm your payment yet.</p>
            <p>Please wait a minute, then refresh this page, or contact sales.</p>
          </>
        )}
      </div>
    </main>
  )
}
