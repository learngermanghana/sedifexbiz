import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

const globalObject = globalThis as typeof globalThis & Record<string, unknown>

if (typeof globalObject.IDBDatabase === 'undefined') {
  class NoopIDBDatabase {}
  class NoopIDBObjectStore {}
  class NoopIDBIndex {}
  class NoopIDBCursor {}
  class NoopIDBTransaction {}
  class NoopIDBKeyRange {}
  class NoopIDBRequest {}

  const noop = () => {}

  Object.assign(NoopIDBCursor.prototype, {
    advance: noop,
    ['continue']: noop,
    continuePrimaryKey: noop,
  })

  Object.assign(globalObject, {
    IDBDatabase: NoopIDBDatabase,
    IDBObjectStore: NoopIDBObjectStore,
    IDBIndex: NoopIDBIndex,
    IDBCursor: NoopIDBCursor,
    IDBTransaction: NoopIDBTransaction,
    IDBKeyRange: NoopIDBKeyRange,
    IDBRequest: NoopIDBRequest,
  })
}

beforeEach(() => {
  // Ensure print is stubbed so tests can observe invocations without touching the real browser API.
  Object.defineProperty(window, 'print', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })
})
