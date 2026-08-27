import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NavigationSettingsSection from '../components/NavigationSettingsSection'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'
import { useStorePreferences } from '../hooks/useStorePreferences'
import {
  fetchOnboardingStatus,
  getOnboardingStatus,
  setOnboardingStatus,
  type OnboardingStatus,
} from '../utils/onboarding'
import './Onboarding.css'

export default function Onboarding() {
  const user = useAuthUser()
  const navigate = useNavigate()
  const { storeId, isLoading, error } = useActiveStore()
  const { preferences, loading: preferencesLoading, updatePreferences } = useStorePreferences(storeId)
  const [status, setStatus] = useState<OnboardingStatus>(
    () => getOnboardingStatus(user?.uid ?? null) ?? 'pending',
  )

  useEffect(() => {
    let isActive = true

    void (async () => {
      const uid = user?.uid ?? null
      const resolvedStatus =
        (await fetchOnboardingStatus(uid)) ?? getOnboardingStatus(uid) ?? 'pending'
      if (!isActive) return
      setStatus(resolvedStatus)
      await setOnboardingStatus(uid, resolvedStatus)
    })()

    return () => {
      isActive = false
    }
  }, [user?.uid])

  async function handleComplete() {
    if (!user) return
    await setOnboardingStatus(user.uid, 'completed')
    setStatus('completed')
    navigate('/', { replace: true })
  }

  return (
    <div className="page onboarding-page" role="region" aria-labelledby="onboarding-title">
      <header className="page__header onboarding-page__header">
        <div>
          <h1 className="page__title" id="onboarding-title">Choose your navigation</h1>
          <p className="page__subtitle">
            Sedifex automatically selects the recommended pages for the business type you chose during signup.
            You can keep those defaults now and add more pages later from Account → Navigation settings whenever your business needs them.
          </p>
        </div>
        {status === 'completed' && (
          <span className="onboarding-page__status" role="status">Onboarding complete</span>
        )}
      </header>

      <section className="card onboarding-card" aria-label="Navigation setup">
        {isLoading || preferencesLoading ? (
          <p role="status">Loading the recommended pages for your business type…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : storeId ? (
          <NavigationSettingsSection
            preferences={preferences.navigation}
            canEdit
            onSave={async navigation => updatePreferences({ navigation })}
          />
        ) : (
          <p role="status">Select a workspace to configure its navigation.</p>
        )}
      </section>

      <button
        type="button"
        className="button button--primary onboarding-card__cta"
        disabled={!storeId || isLoading || preferencesLoading}
        onClick={() => void handleComplete()}
      >
        Save and open dashboard
      </button>
    </div>
  )
}
