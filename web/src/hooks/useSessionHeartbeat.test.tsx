import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useSessionHeartbeat } from './useSessionHeartbeat'

const mockRefreshSessionHeartbeat = vi.fn(async () => {})

vi.mock('../controllers/sessionController', () => ({
  refreshSessionHeartbeat: (...args: unknown[]) => mockRefreshSessionHeartbeat(...args),
}))

describe('useSessionHeartbeat', () => {
  it('runs the session heartbeat when a user is present', () => {
    const user = { uid: 'user-123' }

    renderHook(() => useSessionHeartbeat(user as any))

    expect(mockRefreshSessionHeartbeat).toHaveBeenCalledWith(user)
  })

  it('does nothing without a user', () => {
    renderHook(() => useSessionHeartbeat(null))

    expect(mockRefreshSessionHeartbeat).not.toHaveBeenCalled()
  })
})
