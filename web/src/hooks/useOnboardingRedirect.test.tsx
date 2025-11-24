import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useOnboardingRedirect } from './useOnboardingRedirect'

const mockNavigate = vi.fn()
const mockGetOnboardingStatus = vi.fn<[], 'pending' | 'done' | null>(() => 'pending')
const mockSetOnboardingStatus = vi.fn()

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/dashboard' }),
  }
})

vi.mock('../utils/onboarding', () => ({
  getOnboardingStatus: (..._args: unknown[]) => mockGetOnboardingStatus(),
  setOnboardingStatus: (...args: unknown[]) => mockSetOnboardingStatus(...args),
}))

describe('useOnboardingRedirect', () => {
  it('flags onboarding as pending when missing and redirects to onboarding', () => {
    renderHook(() => useOnboardingRedirect({ uid: 'user-1' } as any))

    expect(mockGetOnboardingStatus).toHaveBeenCalledWith('user-1')
    expect(mockSetOnboardingStatus).toHaveBeenCalledWith('user-1', 'pending')
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true })
  })

  it('avoids redirecting when onboarding already completed', () => {
    mockNavigate.mockReset()
    mockGetOnboardingStatus.mockReturnValueOnce('done')

    renderHook(() => useOnboardingRedirect({ uid: 'user-2' } as any))

    expect(mockSetOnboardingStatus).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
