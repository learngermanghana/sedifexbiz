import React, { useMemo, useState } from 'react'
import PageSection from '../layout/PageSection'
import { requestAiAdvisor, type AiAdvisorResponse } from '../api/aiAdvisor'
import { useActiveStore } from '../hooks/useActiveStore'
import { useStoreBilling } from '../hooks/useStoreBilling'
import './AiAdvisor.css'

type AdvisorTurn = {
  question: string
  response: AiAdvisorResponse
}

type AdvisorFormState = {
  question: string
  loading: boolean
  error: string | null
  turns: AdvisorTurn[]
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
    turns: [],
  })

  const jsonContext = useMemo(
    () => buildJsonContext(storeId, billingState.billing),
    [storeId, billingState.billing],
  )

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedQuestion = state.question.trim()
    if (!trimmedQuestion) {
      setState(prev => ({ ...prev, error: 'Ask a question for the AI to answer.' }))
      return
    }

    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
    }))

    try {
      const result = await requestAiAdvisor({
        question: trimmedQuestion,
        storeId: storeId ?? undefined,
        jsonContext,
      })

      setState(prev => ({
        ...prev,
        loading: false,
        turns: [...prev.turns, { question: trimmedQuestion, response: result }],
      }))
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

        <div className="advisor__card advisor__card--chat">
          <div className="advisor__card-header">
            <div>
              <h3>AI chat</h3>
              <p className="advisor__subtitle">
                Ask a question above and follow the conversation like a chat thread.
              </p>
            </div>
            <span className="advisor__badge advisor__badge--success">
              {state.loading ? 'Responding…' : 'Live'}
            </span>
          </div>

          {state.turns.length ? (
            <div className="advisor__messages">
              {state.turns.map((turn, index) => (
                <React.Fragment key={`turn-${index}-${turn.response.storeId}`}>
                  <div className="advisor__message advisor__message--user">
                    <div className="advisor__message-header">
                      <span className="advisor__message-label">You</span>
                      <span className="advisor__meta">Workspace: {turn.response.storeId}</span>
                    </div>
                    <p className="advisor__message-content">{turn.question}</p>
                  </div>

                  <div className="advisor__message advisor__message--ai">
                    <div className="advisor__message-header">
                      <span className="advisor__message-label">AI advisor</span>
                    </div>
                    <div className="advisor__message-content advisor__message-content--ai">
                      {turn.response.advice}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <p className="advisor__placeholder">Submit a question to start the chat.</p>
          )}
        </div>
      </div>
    </PageSection>
  )
}
