import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  // Ensure print is stubbed so tests can observe invocations without touching the real browser API.
  Object.defineProperty(window, 'print', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })
})
