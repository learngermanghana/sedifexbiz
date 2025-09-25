import React, { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'
import { AccessDenied } from '../components/AccessDenied'
import { canAccessFeature } from '../utils/permissions'
import './Settings.css'

type TaxRate = {
  id: string
  name: string
  rate: number
}

type Branch = {
  id: string
  name: string
  location?: string
}

type PaymentMethod = {
  id: string
  name: string
  notes?: string
}

type StaffRole = {
  id: string
  name: string
  description?: string
}

type StoreSettings = {
  taxRates: TaxRate[]
  branches: Branch[]
  paymentMethods: PaymentMethod[]
  staffRoles: StaffRole[]
}

function createEmptySettings(): StoreSettings {
  return {
    taxRates: [],
    branches: [],
    paymentMethods: [],
    staffRoles: [],
  }
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function toTaxRates(value: unknown): TaxRate[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const id = typeof candidate.id === 'string' ? candidate.id : null
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      const rateValue = Number(candidate.rate)
      if (!id || !name || !Number.isFinite(rateValue)) return null
      const taxRate: TaxRate = { id, name, rate: rateValue }
      return taxRate
    })
    .filter((entry): entry is TaxRate => entry !== null)
}

function toBranches(value: unknown): Branch[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const id = typeof candidate.id === 'string' ? candidate.id : null
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      if (!id || !name) return null
      const location = typeof candidate.location === 'string' ? candidate.location.trim() : undefined
      const branch: Branch = { id, name }
      if (location) {
        branch.location = location
      }
      return branch
    })
    .filter((entry): entry is Branch => entry !== null)
}

function toPaymentMethods(value: unknown): PaymentMethod[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const id = typeof candidate.id === 'string' ? candidate.id : null
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      if (!id || !name) return null
      const notes = typeof candidate.notes === 'string' ? candidate.notes.trim() : undefined
      const method: PaymentMethod = { id, name }
      if (notes) {
        method.notes = notes
      }
      return method
    })
    .filter((entry): entry is PaymentMethod => entry !== null)
}

function toStaffRoles(value: unknown): StaffRole[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const id = typeof candidate.id === 'string' ? candidate.id : null
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      if (!id || !name) return null
      const description = typeof candidate.description === 'string' ? candidate.description.trim() : undefined
      const staffRole: StaffRole = { id, name }
      if (description) {
        staffRole.description = description
      }
      return staffRole
    })
    .filter((entry): entry is StaffRole => entry !== null)
}

export default function Settings() {
  const user = useAuthUser()
  const { storeId: STORE_ID, role, isLoading: storeLoading, error: storeError } = useActiveStore()
  const hasAccess = canAccessFeature(role, 'settings')

  const [settings, setSettings] = useState<StoreSettings>(() => createEmptySettings())
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [taxName, setTaxName] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [taxBusy, setTaxBusy] = useState(false)
  const [taxError, setTaxError] = useState<string | null>(null)
  const [taxSuccess, setTaxSuccess] = useState<string | null>(null)

  const [branchName, setBranchName] = useState('')
  const [branchLocation, setBranchLocation] = useState('')
  const [branchBusy, setBranchBusy] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [branchSuccess, setBranchSuccess] = useState<string | null>(null)

  const [paymentName, setPaymentName] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null)

  const [roleName, setRoleName] = useState('')
  const [roleDescription, setRoleDescription] = useState('')
  const [roleBusy, setRoleBusy] = useState(false)
  const [roleErrorMessage, setRoleErrorMessage] = useState<string | null>(null)
  const [roleSuccessMessage, setRoleSuccessMessage] = useState<string | null>(null)

  const settingsRef = useMemo(() => {
    if (!STORE_ID || !hasAccess) return null
    return doc(db, 'storeSettings', STORE_ID)
  }, [STORE_ID, hasAccess])

  useEffect(() => {
    if (!settingsRef) {
      setSettings(createEmptySettings())
      setSettingsLoading(false)
      return
    }

    setSettingsLoading(true)
    const unsubscribe = onSnapshot(
      settingsRef,
      snapshot => {
        const data = snapshot.data() as Partial<StoreSettings> | undefined
        setSettings({
          taxRates: toTaxRates(data?.taxRates),
          branches: toBranches(data?.branches),
          paymentMethods: toPaymentMethods(data?.paymentMethods),
          staffRoles: toStaffRoles(data?.staffRoles),
        })
        setSettingsError(null)
        setSettingsLoading(false)
      },
      error => {
        console.error('[settings] Unable to load store settings', error)
        setSettings(createEmptySettings())
        setSettingsError('We could not load your store settings. Data shown here may be incomplete.')
        setSettingsLoading(false)
      }
    )

    return unsubscribe
  }, [settingsRef])

  const isBusy = storeLoading || settingsLoading

  async function persist(partial: Partial<StoreSettings>) {
    if (!settingsRef || !STORE_ID) {
      throw new Error('Missing store context')
    }
    await setDoc(
      settingsRef,
      {
        ...partial,
        storeId: STORE_ID,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  }

  async function handleAddTaxRate(event: React.FormEvent) {
    event.preventDefault()
    if (!settingsRef || !STORE_ID) return

    setTaxError(null)
    setTaxSuccess(null)

    const trimmedName = taxName.trim()
    if (!trimmedName) {
      setTaxError('A name helps staff choose the right rate. Please add one.')
      return
    }

    const parsedRate = Number.parseFloat(taxRate)
    if (!Number.isFinite(parsedRate)) {
      setTaxError('Enter the tax rate as a number, for example "12.5".')
      return
    }
    if (parsedRate < 0) {
      setTaxError('Tax rates cannot be negative.')
      return
    }
    if (parsedRate > 100) {
      setTaxError('Tax rates cannot exceed 100%.')
      return
    }

    setTaxBusy(true)
    const nextRates = [
      ...settings.taxRates,
      { id: createId(), name: trimmedName, rate: Number.parseFloat(parsedRate.toFixed(4)) },
    ]

    try {
      await persist({ taxRates: nextRates })
      setTaxName('')
      setTaxRate('')
      setTaxSuccess('Tax rate saved.')
    } catch (err) {
      console.error('[settings] Unable to save tax rate', err)
      setTaxError('We could not save this tax rate. Please try again.')
    } finally {
      setTaxBusy(false)
    }
  }

  async function handleRemoveTaxRate(id: string) {
    if (!settingsRef || !STORE_ID) return
    const confirmRemoval = window.confirm('Remove this tax rate?')
    if (!confirmRemoval) return

    setTaxBusy(true)
    setTaxError(null)
    setTaxSuccess(null)

    try {
      await persist({ taxRates: settings.taxRates.filter(rate => rate.id !== id) })
      setTaxSuccess('Tax rate removed.')
    } catch (err) {
      console.error('[settings] Unable to remove tax rate', err)
      setTaxError('We could not remove this tax rate right now.')
    } finally {
      setTaxBusy(false)
    }
  }

  async function handleAddBranch(event: React.FormEvent) {
    event.preventDefault()
    if (!settingsRef || !STORE_ID) return

    setBranchError(null)
    setBranchSuccess(null)

    const trimmedName = branchName.trim()
    const trimmedLocation = branchLocation.trim()
    if (!trimmedName) {
      setBranchError('Branch name is required to save a location.')
      return
    }

    setBranchBusy(true)
    const nextBranches = [
      ...settings.branches,
      {
        id: createId(),
        name: trimmedName,
        ...(trimmedLocation ? { location: trimmedLocation } : {}),
      },
    ]

    try {
      await persist({ branches: nextBranches })
      setBranchName('')
      setBranchLocation('')
      setBranchSuccess('Branch saved.')
    } catch (err) {
      console.error('[settings] Unable to save branch', err)
      setBranchError('We could not save this branch. Please try again.')
    } finally {
      setBranchBusy(false)
    }
  }

  async function handleRemoveBranch(id: string) {
    if (!settingsRef || !STORE_ID) return
    const confirmRemoval = window.confirm('Remove this branch?')
    if (!confirmRemoval) return

    setBranchBusy(true)
    setBranchError(null)
    setBranchSuccess(null)

    try {
      await persist({ branches: settings.branches.filter(branch => branch.id !== id) })
      setBranchSuccess('Branch removed.')
    } catch (err) {
      console.error('[settings] Unable to remove branch', err)
      setBranchError('We could not remove this branch right now.')
    } finally {
      setBranchBusy(false)
    }
  }

  async function handleAddPaymentMethod(event: React.FormEvent) {
    event.preventDefault()
    if (!settingsRef || !STORE_ID) return

    setPaymentError(null)
    setPaymentSuccess(null)

    const trimmedName = paymentName.trim()
    const trimmedNotes = paymentNotes.trim()
    if (!trimmedName) {
      setPaymentError('Give this payment method a clear label so staff recognise it at checkout.')
      return
    }

    setPaymentBusy(true)
    const nextMethods = [
      ...settings.paymentMethods,
      {
        id: createId(),
        name: trimmedName,
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      },
    ]

    try {
      await persist({ paymentMethods: nextMethods })
      setPaymentName('')
      setPaymentNotes('')
      setPaymentSuccess('Payment method saved.')
    } catch (err) {
      console.error('[settings] Unable to save payment method', err)
      setPaymentError('We could not save this payment method. Please try again.')
    } finally {
      setPaymentBusy(false)
    }
  }

  async function handleRemovePaymentMethod(id: string) {
    if (!settingsRef || !STORE_ID) return
    const confirmRemoval = window.confirm('Remove this payment method?')
    if (!confirmRemoval) return

    setPaymentBusy(true)
    setPaymentError(null)
    setPaymentSuccess(null)

    try {
      await persist({ paymentMethods: settings.paymentMethods.filter(method => method.id !== id) })
      setPaymentSuccess('Payment method removed.')
    } catch (err) {
      console.error('[settings] Unable to remove payment method', err)
      setPaymentError('We could not remove this payment method right now.')
    } finally {
      setPaymentBusy(false)
    }
  }

  async function handleAddRole(event: React.FormEvent) {
    event.preventDefault()
    if (!settingsRef || !STORE_ID) return

    setRoleErrorMessage(null)
    setRoleSuccessMessage(null)

    const trimmedName = roleName.trim()
    const trimmedDescription = roleDescription.trim()
    if (!trimmedName) {
      setRoleErrorMessage('Role name is required so you can assign responsibilities later.')
      return
    }

    setRoleBusy(true)
    const nextRoles = [
      ...settings.staffRoles,
      {
        id: createId(),
        name: trimmedName,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      },
    ]

    try {
      await persist({ staffRoles: nextRoles })
      setRoleName('')
      setRoleDescription('')
      setRoleSuccessMessage('Staff role saved.')
    } catch (err) {
      console.error('[settings] Unable to save staff role', err)
      setRoleErrorMessage('We could not save this role. Please try again.')
    } finally {
      setRoleBusy(false)
    }
  }

  async function handleRemoveRole(id: string) {
    if (!settingsRef || !STORE_ID) return
    const confirmRemoval = window.confirm('Remove this staff role?')
    if (!confirmRemoval) return

    setRoleBusy(true)
    setRoleErrorMessage(null)
    setRoleSuccessMessage(null)

    try {
      await persist({ staffRoles: settings.staffRoles.filter(item => item.id !== id) })
      setRoleSuccessMessage('Staff role removed.')
    } catch (err) {
      console.error('[settings] Unable to remove staff role', err)
      setRoleErrorMessage('We could not remove this role right now.')
    } finally {
      setRoleBusy(false)
    }
  }

  if (!storeLoading && !hasAccess) {
    return <AccessDenied feature="settings" role={role ?? null} />
  }

  if (storeLoading) {
    return <div className="page">Loading store access…</div>
  }

  if (!STORE_ID) {
    return <div className="page">We were unable to determine your store access. Please sign out and back in.</div>
  }

  return (
    <div className="page settings-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Store settings</h2>
          <p className="page__subtitle">
            Configure the rules that keep your branches aligned — taxes, locations, tender options, and staff
            responsibilities.
          </p>
        </div>
      </header>

      {storeError && <p className="settings-message settings-message--error">{storeError}</p>}
      {settingsError && <p className="settings-message settings-message--error">{settingsError}</p>}
      {settingsLoading && <p className="settings-page__loading" role="status">Loading store settings…</p>}

      <div className="settings-page__grid">
        <section className="card settings-page__summary" aria-label="Store overview">
          <div className="settings-section__header">
            <h3 className="card__title">Store overview</h3>
            <p className="card__subtitle">Quick reference for your current workspace access.</p>
          </div>

          <dl className="settings-summary">
            <div className="settings-summary__item">
              <dt className="settings-summary__label">Store ID</dt>
              <dd className="settings-summary__value">{STORE_ID}</dd>
            </div>
            <div className="settings-summary__item">
              <dt className="settings-summary__label">Role</dt>
              <dd className="settings-summary__value">{role ?? 'Not assigned'}</dd>
            </div>
            <div className="settings-summary__item">
              <dt className="settings-summary__label">Signed in as</dt>
              <dd className="settings-summary__value">{user?.email ?? 'Unknown user'}</dd>
            </div>
          </dl>
        </section>

        <section className="card" aria-label="Tax rates">
          <div className="settings-section__header">
            <h3 className="card__title">Tax rates</h3>
            <p className="card__subtitle">
              Create reusable tax codes so the sales floor can assign the right VAT or levy when ringing up items.
            </p>
          </div>

          <form className="settings-form" onSubmit={handleAddTaxRate}>
            <div className="settings-form__row">
              <div className="field">
                <label className="field__label" htmlFor="tax-name">
                  Label
                </label>
                <input
                  id="tax-name"
                  value={taxName}
                  onChange={event => setTaxName(event.target.value)}
                  placeholder="e.g. Standard VAT"
                  disabled={taxBusy || isBusy}
                  required
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="tax-rate">
                  Rate (%)
                </label>
                <input
                  id="tax-rate"
                  value={taxRate}
                  onChange={event => setTaxRate(event.target.value)}
                  placeholder="12.50"
                  inputMode="decimal"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="input--align-right"
                  disabled={taxBusy || isBusy}
                  required
                />
              </div>
            </div>

            {taxError && <p className="settings-message settings-message--error">{taxError}</p>}
            {taxSuccess && !taxError && (
              <p className="settings-message settings-message--success" role="status">
                {taxSuccess}
              </p>
            )}

            <div className="settings-list__actions">
              <button type="submit" className="button button--primary button--small" disabled={taxBusy || isBusy}>
                Save tax rate
              </button>
            </div>
          </form>

          {settings.taxRates.length > 0 ? (
            <ul className="settings-list" role="list">
              {settings.taxRates.map(rate => (
                <li className="settings-list__item" key={rate.id}>
                  <div className="settings-list__content">
                    <p className="settings-list__title">{rate.name}</p>
                    <p className="settings-list__meta">{rate.rate}%</p>
                  </div>
                  <div className="settings-list__actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => handleRemoveTaxRate(rate.id)}
                      disabled={taxBusy || isBusy}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="settings-empty">
              <h4 className="settings-empty__title">No tax rates yet</h4>
              <p>Tax codes that you add here appear anywhere Sedifex needs a percentage rate.</p>
            </div>
          )}
        </section>

        <section className="card" aria-label="Branches">
          <div className="settings-section__header">
            <h3 className="card__title">Branches</h3>
            <p className="card__subtitle">
              Map each trading location so stock, staff, and reporting stay aligned with the right branch.
            </p>
          </div>

          <form className="settings-form" onSubmit={handleAddBranch}>
            <div className="settings-form__row">
              <div className="field">
                <label className="field__label" htmlFor="branch-name">
                  Branch name
                </label>
                <input
                  id="branch-name"
                  value={branchName}
                  onChange={event => setBranchName(event.target.value)}
                  placeholder="e.g. Kumasi Mall"
                  disabled={branchBusy || isBusy}
                  required
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="branch-location">
                  Address or landmark
                </label>
                <input
                  id="branch-location"
                  value={branchLocation}
                  onChange={event => setBranchLocation(event.target.value)}
                  placeholder="Opposite Jubilee House"
                  disabled={branchBusy || isBusy}
                />
              </div>
            </div>

            {branchError && <p className="settings-message settings-message--error">{branchError}</p>}
            {branchSuccess && !branchError && (
              <p className="settings-message settings-message--success" role="status">
                {branchSuccess}
              </p>
            )}

            <div className="settings-list__actions">
              <button type="submit" className="button button--primary button--small" disabled={branchBusy || isBusy}>
                Save branch
              </button>
            </div>
          </form>

          {settings.branches.length > 0 ? (
            <ul className="settings-list" role="list">
              {settings.branches.map(branch => (
                <li className="settings-list__item" key={branch.id}>
                  <div className="settings-list__content">
                    <p className="settings-list__title">{branch.name}</p>
                    <p className="settings-list__description">{branch.location ?? 'Location not provided'}</p>
                  </div>
                  <div className="settings-list__actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => handleRemoveBranch(branch.id)}
                      disabled={branchBusy || isBusy}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="settings-empty">
              <h4 className="settings-empty__title">No branches added</h4>
              <p>List each store or warehouse so you can assign inventory and staff to the right place.</p>
            </div>
          )}
        </section>

        <section className="card" aria-label="Payment methods">
          <div className="settings-section__header">
            <h3 className="card__title">Payment methods</h3>
            <p className="card__subtitle">
              Capture the payment types you accept and any instructions staff should follow during checkout.
            </p>
          </div>

          <form className="settings-form" onSubmit={handleAddPaymentMethod}>
            <div className="settings-form__row">
              <div className="field">
                <label className="field__label" htmlFor="payment-name">
                  Payment name
                </label>
                <input
                  id="payment-name"
                  value={paymentName}
                  onChange={event => setPaymentName(event.target.value)}
                  placeholder="e.g. Mobile money"
                  disabled={paymentBusy || isBusy}
                  required
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="payment-notes">
                  Instructions
                </label>
                <input
                  id="payment-notes"
                  value={paymentNotes}
                  onChange={event => setPaymentNotes(event.target.value)}
                  placeholder="e.g. Dial *170# after confirming amount"
                  disabled={paymentBusy || isBusy}
                />
              </div>
            </div>

            {paymentError && <p className="settings-message settings-message--error">{paymentError}</p>}
            {paymentSuccess && !paymentError && (
              <p className="settings-message settings-message--success" role="status">
                {paymentSuccess}
              </p>
            )}

            <div className="settings-list__actions">
              <button type="submit" className="button button--primary button--small" disabled={paymentBusy || isBusy}>
                Save payment method
              </button>
            </div>
          </form>

          {settings.paymentMethods.length > 0 ? (
            <ul className="settings-list" role="list">
              {settings.paymentMethods.map(method => (
                <li className="settings-list__item" key={method.id}>
                  <div className="settings-list__content">
                    <p className="settings-list__title">{method.name}</p>
                    <p className="settings-list__description">{method.notes ?? 'No special instructions'}</p>
                  </div>
                  <div className="settings-list__actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => handleRemovePaymentMethod(method.id)}
                      disabled={paymentBusy || isBusy}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="settings-empty">
              <h4 className="settings-empty__title">No payment methods saved</h4>
              <p>Keep tills moving by listing every tender type you accept and what staff should collect.</p>
            </div>
          )}
        </section>

        <section className="card" aria-label="Staff roles">
          <div className="settings-section__header">
            <h3 className="card__title">Staff roles</h3>
            <p className="card__subtitle">
              Define expectations for each role so onboarding and delegating tasks stays consistent across stores.
            </p>
          </div>

          <form className="settings-form" onSubmit={handleAddRole}>
            <div className="settings-form__row">
              <div className="field">
                <label className="field__label" htmlFor="role-name">
                  Role name
                </label>
                <input
                  id="role-name"
                  value={roleName}
                  onChange={event => setRoleName(event.target.value)}
                  placeholder="e.g. Shift supervisor"
                  disabled={roleBusy || isBusy}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="role-description">
                Responsibilities
              </label>
              <textarea
                id="role-description"
                value={roleDescription}
                onChange={event => setRoleDescription(event.target.value)}
                placeholder="Summarise duties, KPIs, or permissions for this role"
                rows={3}
                disabled={roleBusy || isBusy}
              />
            </div>

            {roleErrorMessage && <p className="settings-message settings-message--error">{roleErrorMessage}</p>}
            {roleSuccessMessage && !roleErrorMessage && (
              <p className="settings-message settings-message--success" role="status">
                {roleSuccessMessage}
              </p>
            )}

            <div className="settings-list__actions">
              <button type="submit" className="button button--primary button--small" disabled={roleBusy || isBusy}>
                Save staff role
              </button>
            </div>
          </form>

          {settings.staffRoles.length > 0 ? (
            <ul className="settings-list" role="list">
              {settings.staffRoles.map(item => (
                <li className="settings-list__item" key={item.id}>
                  <div className="settings-list__content">
                    <p className="settings-list__title">{item.name}</p>
                    <p className="settings-list__description">{item.description ?? 'No notes provided'}</p>
                  </div>
                  <div className="settings-list__actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => handleRemoveRole(item.id)}
                      disabled={roleBusy || isBusy}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="settings-empty">
              <h4 className="settings-empty__title">No staff roles configured</h4>
              <p>Document the expectations for each position so new hires can hit the ground running.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
