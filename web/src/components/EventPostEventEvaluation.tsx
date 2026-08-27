import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'

type EvaluationRole = 'elite_core' | 'vendor' | 'client'

type EventEvaluation = {
  id: string
  respondentType: EvaluationRole
  respondentName: string
  organisation: string
  punctuality: number
  communication: number
  professionalism: number
  quality: number
  issueHandling: number
  overallScore: number
  strengths: string
  improvements: string
  recommendation: string
  wouldWorkAgain: boolean
  createdAt: Date | null
}

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
  onChanged?: () => void | Promise<void>
}

const ROLE_LABELS: Record<EvaluationRole, string> = {
  elite_core: 'Elite Core event staff',
  vendor: 'Vendor / supplier',
  client: 'Client survey',
}

const SCORE_LABELS: Record<number, string> = {
  1: '1 · Poor',
  2: '2 · Needs improvement',
  3: '3 · Good',
  4: '4 · Very good',
  5: '5 · Excellent',
}

const EMPTY_FORM = {
  respondentType: 'elite_core' as EvaluationRole,
  respondentName: '',
  organisation: '',
  punctuality: 5,
  communication: 5,
  professionalism: 5,
  quality: 5,
  issueHandling: 5,
  strengths: '',
  improvements: '',
  recommendation: '',
  wouldWorkAgain: true,
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function score(value: unknown) {
  const parsed = Math.round(Number(value) || 0)
  return Math.max(1, Math.min(5, parsed || 1))
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate()
  if (value && typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate()
  }
  return null
}

function isRole(value: unknown): value is EvaluationRole {
  return ['elite_core', 'vendor', 'client'].includes(String(value))
}

function mapEvaluation(id: string, data: Record<string, unknown>): EventEvaluation {
  const scores = [score(data.punctuality), score(data.communication), score(data.professionalism), score(data.quality), score(data.issueHandling)]
  const calculatedOverall = scores.reduce((sum, value) => sum + value, 0) / scores.length
  return {
    id,
    respondentType: isRole(data.respondentType) ? data.respondentType : 'elite_core',
    respondentName: text(data.respondentName) || 'Unnamed respondent',
    organisation: text(data.organisation),
    punctuality: scores[0],
    communication: scores[1],
    professionalism: scores[2],
    quality: scores[3],
    issueHandling: scores[4],
    overallScore: Number(data.overallScore) || calculatedOverall,
    strengths: text(data.strengths),
    improvements: text(data.improvements),
    recommendation: text(data.recommendation),
    wouldWorkAgain: data.wouldWorkAgain !== false,
    createdAt: toDate(data.createdAt),
  }
}

function formatDate(value: Date | null) {
  if (!value) return 'Just recorded'
  return value.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ratingAverage(form: typeof EMPTY_FORM) {
  return (form.punctuality + form.communication + form.professionalism + form.quality + form.issueHandling) / 5
}

export default function EventPostEventEvaluation({ storeId, eventId, eventTitle, onChanged }: Props) {
  const [eventStatus, setEventStatus] = useState('')
  const [evaluations, setEvaluations] = useState<EventEvaluation[]>([])
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const eventRef = useMemo(() => doc(db, 'stores', storeId, 'events', eventId), [storeId, eventId])
  const evaluationsRef = useMemo(() => collection(eventRef, 'postEventEvaluations'), [eventRef])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [eventSnapshot, evaluationSnapshot] = await Promise.all([
        getDoc(eventRef),
        getDocs(query(evaluationsRef, orderBy('createdAt', 'desc'))),
      ])
      if (!eventSnapshot.exists()) throw new Error('EVENT_NOT_FOUND')
      const status = text(eventSnapshot.data().status)
      const mapped = evaluationSnapshot.docs.map(item => mapEvaluation(item.id, item.data()))
      setEventStatus(status)
      setEvaluations(mapped)

      const evaluationState = text(eventSnapshot.data().postEventEvaluationStatus)
      if (status === 'completed' && !evaluationState) {
        await updateDoc(eventRef, {
          postEventEvaluationStatus: mapped.length ? 'in_progress' : 'open',
          postEventEvaluationOpenedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
    } catch (loadError) {
      console.error('[event-evaluation] Unable to load post-event evaluations', loadError)
      setError('Post-event evaluations could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [eventRef, evaluationsRef])

  useEffect(() => { void load() }, [load])

  const roleCounts = useMemo(() => ({
    elite_core: evaluations.filter(item => item.respondentType === 'elite_core').length,
    vendor: evaluations.filter(item => item.respondentType === 'vendor').length,
    client: evaluations.filter(item => item.respondentType === 'client').length,
  }), [evaluations])

  const averageOverall = useMemo(() => evaluations.length
    ? evaluations.reduce((sum, item) => sum + item.overallScore, 0) / evaluations.length
    : 0, [evaluations])

  async function syncEventSummary(next: EventEvaluation[]) {
    const roles = new Set(next.map(item => item.respondentType))
    const complete = roles.has('elite_core') && roles.has('vendor') && roles.has('client')
    const average = next.length ? next.reduce((sum, item) => sum + item.overallScore, 0) / next.length : 0
    await updateDoc(eventRef, {
      postEventEvaluationStatus: next.length ? (complete ? 'complete' : 'in_progress') : 'open',
      postEventEvaluationCount: next.length,
      postEventEvaluationAverage: Number(average.toFixed(2)),
      postEventEvaluationUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  async function saveEvaluation(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    if (eventStatus !== 'completed') {
      setError('Mark the event as Completed before recording post-event evaluations.')
      return
    }
    if (!form.respondentName.trim()) {
      setError('Enter the name of the person completing the evaluation.')
      return
    }
    if (form.respondentType === 'vendor' && !form.organisation.trim()) {
      setError('Enter the vendor or supplier name so Sedifex can build vendor performance history.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const evaluationRef = doc(evaluationsRef)
      const overall = ratingAverage(form)
      const payload = {
        respondentType: form.respondentType,
        respondentName: form.respondentName.trim(),
        organisation: form.organisation.trim(),
        punctuality: form.punctuality,
        communication: form.communication,
        professionalism: form.professionalism,
        quality: form.quality,
        issueHandling: form.issueHandling,
        overallScore: Number(overall.toFixed(2)),
        strengths: form.strengths.trim(),
        improvements: form.improvements.trim(),
        recommendation: form.recommendation.trim(),
        wouldWorkAgain: form.wouldWorkAgain,
        eventId,
        eventTitle,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      const batch = writeBatch(db)
      batch.set(evaluationRef, payload)
      if (form.respondentType === 'vendor') {
        batch.set(doc(db, 'stores', storeId, 'vendorEvaluations', evaluationRef.id), {
          ...payload,
          sourceEvaluationPath: `stores/${storeId}/events/${eventId}/postEventEvaluations/${evaluationRef.id}`,
        })
      }
      await batch.commit()

      const optimistic = mapEvaluation(evaluationRef.id, { ...payload, createdAt: Timestamp.now() })
      const next = [optimistic, ...evaluations]
      setEvaluations(next)
      await syncEventSummary(next)
      await onChanged?.()
      setForm({ ...EMPTY_FORM })
      setSuccess(form.respondentType === 'vendor'
        ? 'Vendor evaluation recorded and added to vendor performance history.'
        : `${ROLE_LABELS[form.respondentType]} evaluation recorded.`)
    } catch (saveError) {
      console.error('[event-evaluation] Unable to save evaluation', saveError)
      setError('The evaluation could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function removeEvaluation(item: EventEvaluation) {
    if (!window.confirm(`Delete the evaluation from ${item.respondentName}?`)) return
    setError(null)
    try {
      if (item.respondentType === 'vendor') {
        const batch = writeBatch(db)
        batch.delete(doc(evaluationsRef, item.id))
        batch.delete(doc(db, 'stores', storeId, 'vendorEvaluations', item.id))
        await batch.commit()
      } else {
        await deleteDoc(doc(evaluationsRef, item.id))
      }
      const next = evaluations.filter(row => row.id !== item.id)
      setEvaluations(next)
      await syncEventSummary(next)
      setSuccess('Evaluation deleted.')
      await onChanged?.()
    } catch (deleteError) {
      console.error('[event-evaluation] Unable to delete evaluation', deleteError)
      setError('The evaluation could not be deleted.')
    }
  }

  if (loading) {
    return <div className="event-planning__loading"><span className="event-planning__spinner" /><p>Loading post-event evaluations…</p></div>
  }

  if (eventStatus !== 'completed') {
    return (
      <div className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
        <h3>Post-event evaluation</h3>
        <p>This workspace opens when the event is marked <strong>Completed</strong>. Elite Core staff, vendors and the client can then be evaluated against the same service standards.</p>
        <span className="event-planning__status event-planning__status--new">Waiting for event completion</span>
      </div>
    )
  }

  return (
    <div>
      {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
      {success ? <p className="event-planning__alert event-planning__alert--success">{success}<button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">×</button></p> : null}

      <div className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3>Post-event evaluation</h3>
            <p>Evaluate delivery after the event. Vendor responses are also copied into the store’s vendor performance history for future comparison.</p>
          </div>
          <strong style={{ fontSize: '1.35rem' }}>{evaluations.length ? `${averageOverall.toFixed(1)}/5` : '—'}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <span className={`event-planning__status event-planning__status--${roleCounts.elite_core ? 'confirmed' : 'new'}`}>Staff · {roleCounts.elite_core}</span>
          <span className={`event-planning__status event-planning__status--${roleCounts.vendor ? 'confirmed' : 'new'}`}>Vendors · {roleCounts.vendor}</span>
          <span className={`event-planning__status event-planning__status--${roleCounts.client ? 'confirmed' : 'new'}`}>Client · {roleCounts.client}</span>
        </div>
      </div>

      <form onSubmit={saveEvaluation} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
        <h3>Record evaluation</h3>
        <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
          <label>Evaluation type<select value={form.respondentType} onChange={e => setForm(previous => ({ ...previous, respondentType: e.target.value as EvaluationRole }))}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Completed by<input required value={form.respondentName} onChange={e => setForm(previous => ({ ...previous, respondentName: e.target.value }))} placeholder="Full name" /></label>
          <label className="event-planning__field--wide">Vendor / organisation<input value={form.organisation} onChange={e => setForm(previous => ({ ...previous, organisation: e.target.value }))} placeholder={form.respondentType === 'vendor' ? 'Required vendor or supplier name' : 'Optional company / department'} /></label>
          {(['punctuality', 'communication', 'professionalism', 'quality', 'issueHandling'] as const).map(key => {
            const labels: Record<typeof key, string> = {
              punctuality: 'Punctuality',
              communication: 'Communication',
              professionalism: 'Professionalism',
              quality: 'Quality of delivery',
              issueHandling: 'Issue handling',
            }
            return <label key={key}>{labels[key]}<select value={form[key]} onChange={e => setForm(previous => ({ ...previous, [key]: Number(e.target.value) }))}>{Object.entries(SCORE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          })}
          <label className="event-planning__field--wide">What went well<textarea rows={3} value={form.strengths} onChange={e => setForm(previous => ({ ...previous, strengths: e.target.value }))} placeholder="Strong performance, good decisions, client or guest feedback" /></label>
          <label className="event-planning__field--wide">What should improve<textarea rows={3} value={form.improvements} onChange={e => setForm(previous => ({ ...previous, improvements: e.target.value }))} placeholder="Delays, communication gaps, quality issues or process changes" /></label>
          <label className="event-planning__field--wide">Recommendation / follow-up<textarea rows={3} value={form.recommendation} onChange={e => setForm(previous => ({ ...previous, recommendation: e.target.value }))} placeholder="What should be repeated, corrected or followed up after this event?" /></label>
          <label className="event-planning__field--wide" style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={form.wouldWorkAgain} onChange={e => setForm(previous => ({ ...previous, wouldWorkAgain: e.target.checked }))} style={{ width: 18, height: 18 }} /><span>{form.respondentType === 'vendor' ? 'We would work with this vendor again.' : form.respondentType === 'client' ? 'The client would recommend / use the service again.' : 'We would use this approach / team again.'}</span></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <strong>Overall score: {ratingAverage(form).toFixed(1)}/5</strong>
          <button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save evaluation'}</button>
        </div>
      </form>

      <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
        {!evaluations.length ? <div className="event-planning__notes"><strong>No evaluations recorded yet</strong><p>Start with the Elite Core team, then add vendor and client feedback.</p></div> : null}
        {evaluations.map(item => (
          <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 360px' }}>
                <strong>{ROLE_LABELS[item.respondentType]} · {item.respondentName}</strong>
                <p style={{ marginTop: 4 }}>{item.organisation ? `${item.organisation} · ` : ''}{formatDate(item.createdAt)}</p>
                <p style={{ marginTop: 6 }}>Punctuality {item.punctuality}/5 · Communication {item.communication}/5 · Professionalism {item.professionalism}/5 · Quality {item.quality}/5 · Issue handling {item.issueHandling}/5</p>
                {item.strengths ? <p><strong>Went well:</strong> {item.strengths}</p> : null}
                {item.improvements ? <p><strong>Improve:</strong> {item.improvements}</p> : null}
                {item.recommendation ? <p><strong>Follow-up:</strong> {item.recommendation}</p> : null}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`event-planning__status event-planning__status--${item.overallScore >= 4 ? 'confirmed' : item.overallScore >= 3 ? 'planning' : 'awaiting_client'}`}>{item.overallScore.toFixed(1)}/5</span>
                <span className={`event-planning__status event-planning__status--${item.wouldWorkAgain ? 'confirmed' : 'awaiting_client'}`}>{item.wouldWorkAgain ? 'Use again' : 'Review needed'}</span>
                <button type="button" className="button button--ghost" onClick={() => void removeEvaluation(item)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
