import { useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

export default function BillingThanks() {
  const [params] = useSearchParams()
  const reference = params.get('reference') || ''
  const navigate = useNavigate()

  useEffect(() => {
    // Optionally: we could show the ref or send telemetry.
    // Webhook will finish activating the workspace.
  }, [reference])

  return (
    <main style={{ padding: 24, maxWidth: 560, margin: '40px auto' }}>
      <h1>Payment received 🎉</h1>
      <p>
        Thanks! We’re finalizing your subscription now.
        You can continue to sign in and finish setup.
      </p>
      {reference && <p style={{ opacity: 0.7 }}>Ref: {reference}</p>}
      <button
        onClick={() => navigate('/auth', { replace: true })}
        className="primary-button"
        style={{ marginTop: 16 }}
      >
        Continue to sign in
      </button>
    </main>
  )
}
