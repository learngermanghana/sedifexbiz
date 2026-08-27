import React, { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'

export type ContractTemplateFields = {
  serviceAgreement: string
  scopeOfWork: string
  paymentTerms: string
  cancellationPolicy: string
}

type StoreContractTemplate = ContractTemplateFields & {
  id: string
  name: string
}

type ContractTemplateOption = StoreContractTemplate & {
  source: 'sedifex' | 'store'
}

type Props = {
  storeId: string
  eventTitle: string
  clientName: string
  contract: ContractTemplateFields
  disabled?: boolean
  onApply: (fields: ContractTemplateFields, templateName: string) => void
}

const STARTER_TEMPLATES: ContractTemplateOption[] = [
  {
    id: 'sedifex-full-planning',
    source: 'sedifex',
    name: 'Full Event Planning',
    serviceAgreement: 'This agreement covers full event planning services for {{event_name}}. The event company will coordinate the agreed planning process with {{client_name}}, manage approved suppliers and timelines, and provide the services listed in the scope of work. The client agrees to provide accurate information, timely approvals and access needed to deliver the event.',
    scopeOfWork: 'Full planning may include event concept development, budget planning, venue and vendor coordination, planning meetings, supplier follow-up, guest-flow planning, event-day timeline preparation and on-site coordination. Any service, purchase or vendor cost not expressly included in the agreed package remains outside the scope unless approved in writing.',
    paymentTerms: 'The client will pay the agreed planning fee according to the invoice and payment schedule issued by the event company. Deposits or booking fees may be non-refundable once work begins. Third-party vendor costs are payable according to the relevant approved quotation or invoice. Outstanding balances must be cleared by the agreed due date before final event delivery.',
    cancellationPolicy: 'Cancellation, postponement and refund eligibility depend on the notice given, work already completed and non-refundable commitments made to third parties. Any approved refund will exclude work already performed, non-refundable booking fees and vendor charges already incurred. A postponed event may require revised pricing where the date, venue, scope or supplier costs change.',
  },
  {
    id: 'sedifex-partial-planning',
    source: 'sedifex',
    name: 'Partial Event Planning',
    serviceAgreement: 'This agreement covers partial planning support for {{event_name}}. The event company will assist {{client_name}} only with the planning areas specifically listed in the scope of work. Responsibilities not listed remain with the client or the client’s appointed vendors.',
    scopeOfWork: 'Partial planning services are limited to the selected planning areas and deliverables agreed for this event. The client remains responsible for all excluded tasks, existing vendor contracts and decisions outside the agreed scope. Additional work requested later may require a separate quotation or written variation.',
    paymentTerms: 'The client will pay the agreed partial-planning fee according to the invoice and payment schedule. Additional services approved after the original scope may be billed separately. Vendor costs and third-party charges remain the client’s responsibility unless expressly included in writing.',
    cancellationPolicy: 'If the client cancels or postpones the service, amounts relating to work already completed, committed staff time, booking fees and non-refundable third-party costs remain payable. Any remaining refundable amount will be determined from the written scope and payment schedule.',
  },
  {
    id: 'sedifex-coordination',
    source: 'sedifex',
    name: 'Event Coordination Only',
    serviceAgreement: 'This agreement covers event coordination for {{event_name}}. The event company is engaged primarily to coordinate the approved plan and event-day execution. {{client_name}} remains responsible for planning decisions, vendor selection and contractual obligations not expressly transferred to the event company.',
    scopeOfWork: 'Coordination may include a pre-event handover, review of confirmed vendors, preparation or refinement of the event-day run sheet, staff and vendor briefing, timing management, guest-flow coordination and event-day issue escalation. Full planning, vendor procurement and major design changes are excluded unless added in writing.',
    paymentTerms: 'The coordination fee is payable according to the issued invoice. The event company may require the final balance before the event date. Overtime, extra staffing, additional coordination days or material scope changes may be invoiced separately where approved.',
    cancellationPolicy: 'Coordination booking fees reserve staff and event capacity and may be non-refundable. Cancellation or postponement charges depend on notice, committed staff time and work already completed. Date changes are subject to team availability and may require a revised fee.',
  },
  {
    id: 'sedifex-staffing',
    source: 'sedifex',
    name: 'Event Staffing / Ushering',
    serviceAgreement: 'This agreement covers event staffing services for {{event_name}}. The event company will provide the agreed number and type of event staff for the scheduled service period, subject to the responsibilities and limits stated in the scope of work.',
    scopeOfWork: 'Staffing may include ushers, wait staff, coordinators, registration staff, guest-direction personnel or other roles specifically booked. The client must provide a safe working environment, clear reporting instructions and any event-specific access required. Duties outside the agreed role, hours or location may require additional approval and fees.',
    paymentTerms: 'Staffing fees are based on the confirmed headcount, roles, hours and any agreed transport or logistics costs. Additional hours, additional personnel or substantial duty changes may be charged separately. The final staffing balance may be required before deployment.',
    cancellationPolicy: 'Staffing cancellations may attract charges where personnel have already been reserved, briefed or deployed. Late cancellations, reduced headcount and postponements are subject to staff availability and the agreed booking terms. Costs already incurred for transport, uniforms or other approved logistics are non-refundable.',
  },
  {
    id: 'sedifex-vendor',
    source: 'sedifex',
    name: 'Vendor / Supplier Agreement',
    serviceAgreement: 'This agreement records the services to be supplied for {{event_name}}. The supplier must provide the agreed goods or services at the required standard, time and location, and must promptly communicate any issue that may affect delivery.',
    scopeOfWork: 'The scope should state the exact deliverables, quantities, setup and breakdown requirements, arrival time, responsible contacts, equipment, staffing and any dependencies. Any substitution or material change requires prior approval from the event company or client representative.',
    paymentTerms: 'Payment will follow the approved quotation, invoice or milestone schedule. Final payment may depend on satisfactory delivery of the agreed scope. Any approved extra cost must be documented before it is incurred unless an emergency makes prior approval impracticable.',
    cancellationPolicy: 'Cancellation, postponement, replacement and refund terms should reflect committed supplier costs and the timing of notice. The supplier must disclose non-refundable commitments and promptly return any refundable amount where delivery will not take place.',
  },
]

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function hasTerms(fields: ContractTemplateFields) {
  return Boolean(
    fields.serviceAgreement.trim()
    || fields.scopeOfWork.trim()
    || fields.paymentTerms.trim()
    || fields.cancellationPolicy.trim(),
  )
}

function interpolate(value: string, eventTitle: string, clientName: string) {
  return value
    .replaceAll('{{event_name}}', eventTitle || 'the event')
    .replaceAll('{{client_name}}', clientName || 'the client')
}

function mapStoreTemplate(id: string, raw: Record<string, unknown>): StoreContractTemplate | null {
  const name = text(raw.name)
  if (!name) return null
  return {
    id,
    name,
    serviceAgreement: text(raw.serviceAgreement),
    scopeOfWork: text(raw.scopeOfWork),
    paymentTerms: text(raw.paymentTerms),
    cancellationPolicy: text(raw.cancellationPolicy),
  }
}

export default function EventContractTemplateManager({ storeId, eventTitle, clientName, contract, disabled = false, onApply }: Props) {
  const [savedTemplates, setSavedTemplates] = useState<StoreContractTemplate[]>([])
  const [selectedId, setSelectedId] = useState(STARTER_TEMPLATES[0].id)
  const [templateName, setTemplateName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const options = useMemo<ContractTemplateOption[]>(() => [
    ...STARTER_TEMPLATES,
    ...savedTemplates.map(template => ({ ...template, source: 'store' as const })),
  ], [savedTemplates])

  const selected = options.find(template => template.id === selectedId) || null

  async function loadSavedTemplates() {
    setLoading(true)
    setError(null)
    try {
      const snapshot = await getDocs(collection(db, 'stores', storeId, 'eventContractTemplates'))
      const next = snapshot.docs
        .map(item => mapStoreTemplate(item.id, item.data() as Record<string, unknown>))
        .filter((item): item is StoreContractTemplate => Boolean(item))
        .sort((a, b) => a.name.localeCompare(b.name))
      setSavedTemplates(next)
    } catch (loadError) {
      console.error('[event-contract-template] Unable to load templates', loadError)
      setError('Saved contract templates could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadSavedTemplates() }, [storeId])

  function applySelected() {
    if (!selected) return
    if (hasTerms(contract) && !window.confirm(`Apply “${selected.name}” and replace the current agreement, scope, payment and cancellation text?`)) return

    onApply({
      serviceAgreement: interpolate(selected.serviceAgreement, eventTitle, clientName),
      scopeOfWork: interpolate(selected.scopeOfWork, eventTitle, clientName),
      paymentTerms: interpolate(selected.paymentTerms, eventTitle, clientName),
      cancellationPolicy: interpolate(selected.cancellationPolicy, eventTitle, clientName),
    }, selected.name)
    setError(null)
    setMessage(`“${selected.name}” applied to this event. Review and customize it before sending.`)
  }

  async function saveAsTemplate() {
    const name = templateName.trim()
    if (!name) {
      setError('Enter a name for the reusable contract template.')
      return
    }
    if (!hasTerms(contract)) {
      setError('Add contract wording before saving it as a template.')
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const created = await addDoc(collection(db, 'stores', storeId, 'eventContractTemplates'), {
        name,
        serviceAgreement: contract.serviceAgreement.trim(),
        scopeOfWork: contract.scopeOfWork.trim(),
        paymentTerms: contract.paymentTerms.trim(),
        cancellationPolicy: contract.cancellationPolicy.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await loadSavedTemplates()
      setSelectedId(created.id)
      setTemplateName('')
      setMessage(`“${name}” saved for future events.`)
    } catch (saveError) {
      console.error('[event-contract-template] Unable to save template', saveError)
      setError('The contract template could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function updateSelectedTemplate() {
    if (!selected || selected.source !== 'store') return
    if (!hasTerms(contract)) {
      setError('Add contract wording before updating the saved template.')
      return
    }
    if (!window.confirm(`Replace the saved wording in “${selected.name}” with the contract currently on screen? Existing event contracts will not change.`)) return

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await updateDoc(doc(db, 'stores', storeId, 'eventContractTemplates', selected.id), {
        serviceAgreement: contract.serviceAgreement.trim(),
        scopeOfWork: contract.scopeOfWork.trim(),
        paymentTerms: contract.paymentTerms.trim(),
        cancellationPolicy: contract.cancellationPolicy.trim(),
        updatedAt: serverTimestamp(),
      })
      await loadSavedTemplates()
      setMessage(`“${selected.name}” updated. Existing event contracts were not changed.`)
    } catch (updateError) {
      console.error('[event-contract-template] Unable to update template', updateError)
      setError('The saved template could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelectedTemplate() {
    if (!selected || selected.source !== 'store') return
    if (!window.confirm(`Delete saved template “${selected.name}”? Existing event contracts will remain unchanged.`)) return

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await deleteDoc(doc(db, 'stores', storeId, 'eventContractTemplates', selected.id))
      setSelectedId(STARTER_TEMPLATES[0].id)
      await loadSavedTemplates()
      setMessage(`“${selected.name}” deleted. Existing event contracts were not changed.`)
    } catch (deleteError) {
      console.error('[event-contract-template] Unable to delete template', deleteError)
      setError('The saved template could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="event-planning__workspace-preview" style={{ marginTop: 0, marginBottom: 18, borderColor: '#d7e1db', background: '#fcfdfb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginTop: 0 }}>
        <div style={{ flex: '1 1 420px' }}>
          <p className="event-planning__eyebrow" style={{ marginBottom: 5 }}>Contract templates</p>
          <h3>Start from a reusable contract</h3>
          <p>Use a Sedifex starter or one of your store’s saved contracts. Applying a template copies its wording into this event; changing the template later never changes an existing event contract.</p>
        </div>
        <small style={{ maxWidth: 300, color: 'var(--event-muted)', lineHeight: 1.45 }}>Sedifex starter wording is a customizable starting point, not legal advice. Review it for your business and jurisdiction before sending.</small>
      </div>

      {error ? <p className="event-planning__alert event-planning__alert--error" style={{ marginTop: 12, marginBottom: 0 }}>{error}</p> : null}
      {message ? <p className="event-planning__alert event-planning__alert--success" style={{ marginTop: 12, marginBottom: 0 }}>{message}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 9, alignItems: 'end', marginTop: 14 }}>
        <label style={{ color: '#4d5c56', fontSize: '.75rem', fontWeight: 800 }}>
          Choose template
          <select value={selectedId} disabled={disabled || loading || busy} onChange={e => { setSelectedId(e.target.value); setError(null); setMessage(null) }} style={{ width: '100%', minHeight: 42, marginTop: 6 }}>
            <optgroup label="Sedifex starter templates">
              {STARTER_TEMPLATES.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
            </optgroup>
            {savedTemplates.length ? (
              <optgroup label="Your saved templates">
                {savedTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
        <button type="button" className="button button--primary" disabled={disabled || loading || busy || !selected} onClick={applySelected}>Apply template</button>
      </div>

      {selected?.source === 'store' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" className="button button--ghost" disabled={disabled || busy} onClick={() => void updateSelectedTemplate()}>Update saved template from current contract</button>
          <button type="button" className="button button--ghost" disabled={disabled || busy} onClick={() => void deleteSelectedTemplate()}>Delete saved template</button>
        </div>
      ) : null}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--event-line)' }}>
        <strong style={{ display: 'block', fontSize: '.8rem' }}>Save this contract for reuse</strong>
        <p style={{ marginTop: 4 }}>After you customize the wording, save it once and reuse it on future events.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 9, alignItems: 'end', marginTop: 10 }}>
          <label style={{ color: '#4d5c56', fontSize: '.75rem', fontWeight: 800 }}>
            Template name
            <input value={templateName} disabled={disabled || busy} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Elite Core Full Planning Contract" style={{ width: '100%', minHeight: 42, marginTop: 6 }} />
          </label>
          <button type="button" className="button button--ghost" disabled={disabled || busy || !templateName.trim() || !hasTerms(contract)} onClick={() => void saveAsTemplate()}>{busy ? 'Saving…' : 'Save current as template'}</button>
        </div>
      </div>
    </section>
  )
}
