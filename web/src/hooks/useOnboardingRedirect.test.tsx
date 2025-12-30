import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useOnboardingRedirect } from './useOnboardingRedirect'

const mockNavigate = vi.fn()
const mockGetOnboardingStatus = vi.fn<[], 'pending' | 'completed' | null>(
  () => 'pending',
)
const mockFetchOnboardingStatus = vi.fn(() => Promise.resolve<'pending' | 'completed' | null>('pending'))
const mockSetOnboardingStatus = vi.fn(() => Promise.resolve())

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
  fetchOnboardingStatus: (..._args: unknown[]) => mockFetchOnboardingStatus(),
  setOnboardingStatus: (...args: unknown[]) => mockSetOnboardingStatus(...args),
}))

describe('useOnboardingRedirect', () => {
  it('flags onboarding as pending when missing and redirects to onboarding', async () => {
    renderHook(() => useOnboardingRedirect({ uid: 'user-1' } as any))

    await waitFor(() => {
      expect(mockFetchOnboardingStatus).toHaveBeenCalledWith('user-1')
      expect(mockSetOnboardingStatus).toHaveBeenCalledWith('user-1', 'pending')
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true })
    })
  })

  it('avoids redirecting when onboarding already completed', async () => {
    mockNavigate.mockReset()
    mockFetchOnboardingStatus.mockResolvedValueOnce('completed')

    renderHook(() => useOnboardingRedirect({ uid: 'user-2' } as any))

    await waitFor(() => {
      expect(mockSetOnboardingStatus).toHaveBeenCalledWith('user-2', 'completed')
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })
})
