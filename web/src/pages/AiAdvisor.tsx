import React, { useMemo, useState } from 'react'
import PageSection from '../layout/PageSection'
import { requestAiAdvisor, type AiAdvisorResponse } from '../api/aiAdvisor'
import { useActiveStore } from '../hooks/useActiveStore'
import { useStoreBilling } from '../hooks/useStoreBilling'
import './AiAdvisor.css'

type AdvisorFormState = {
  question: string
  loading: boolean
  error: string | null
  result: AiAdvisorResponse | null
}

function buildJsonContext(storeId: string | null, billing: ReturnType<typeof useStoreBilling>['billing']) {
  return {
    storeId,
    billing: billing
      ? {
          status: billing.status,
          planKey: billing.planKey,
          trialEndsAt: billing.trialEndsAt?.toDate?.()?.toISOString?.() ?? null,
          paymentStatus: billing.paymentStatus,
          contractEnd: billing.contractEnd?.toDate?.()?.toISOString?.() ?? null,
        }
      : null,
  }
}

export default function AiAdvisor() {
  const { storeId } = useActiveStore()
  const billingState = useStoreBilling()
  const [state, setState] = useState<AdvisorFormState>({
    question: 'How can we improve sales and reduce stockouts based on this data?',
    loading: false,
    error: null,
    result: null,
  })

  const jsonContext = useMemo(
    () => buildJsonContext(storeId, billingState.billing),
    [storeId, billingState.billing],
  )

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!state.question.trim()) {
      setState(prev => ({ ...prev, error: 'Ask a question for the AI to answer.' }))
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const result = await requestAiAdvisor({
        question: state.question,
        storeId: storeId ?? undefined,
        jsonContext,
      })

      setState(prev => ({ ...prev, result, loading: false }))
    } catch (error: unknown) {
      console.error('[AiAdvisor] Unable to fetch advice', error)
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'We could not fetch advice right now. Please try again.'
      setState(prev => ({ ...prev, error: message, loading: false }))
    }
  }

  return (
    <PageSection
      title="AI advisor"
      subtitle="Ask about your workspace and get quick suggestions based on Firebase data."
    >
      <div className="advisor">
        <form className="advisor__form" onSubmit={handleSubmit}>
          <label className="advisor__label" htmlFor="advisor-question">
            What would you like help with?
          </label>
          <textarea
            id="advisor-question"
            className="advisor__textarea"
            value={state.question}
            rows={4}
            onChange={event =>
              setState(prev => ({ ...prev, question: event.target.value, error: null }))
            }
            placeholder="E.g., give me guidance on reducing churn or improving inventory turns."
          />

          <div className="advisor__actions">
            <button type="submit" className="button" disabled={state.loading}>
              {state.loading ? 'Generating…' : 'Generate advice'}
            </button>
            {state.error ? <span className="advisor__error">{state.error}</span> : null}
          </div>
        </form>

        <div className="advisor__grid">
          <div className="advisor__card">
            <div className="advisor__card-header">
              <h3>Context sent to AI</h3>
              <span className="advisor__badge">JSON</span>
            </div>
            <pre className="advisor__code">{JSON.stringify(jsonContext, null, 2)}</pre>
          </div>

          <div className="advisor__card">
            <div className="advisor__card-header">
              <h3>AI suggestions</h3>
              <span className="advisor__badge advisor__badge--success">Live</span>
            </div>
            {state.result ? (
              <div className="advisor__result">
                <p className="advisor__meta">Workspace: {state.result.storeId}</p>
                <div className="advisor__advice">{state.result.advice}</div>
              </div>
            ) : (
              <p className="advisor__placeholder">Submit a question to see advice here.</p>
            )}
          </div>
        </div>
      </div>
    </PageSection>
  )
}
