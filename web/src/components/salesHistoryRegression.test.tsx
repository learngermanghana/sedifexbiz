import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import CompactBusinessDashboard from './CompactBusinessDashboard'
import CustomerCRM from '../pages/CustomerCRM'

type Row = { id: string; [key: string]: unknown }
type Constraint = { kind: string; field?: string; op?: string; value?: unknown }
type TestQuery = { path: string; constraints?: Constraint[] }
const fixture = vi.hoisted(() => ({ sales: [] as Row[], unsubscribed: vi.fn(), queries: [] as TestQuery[] }))
vi.mock('../firebase', () => ({ db: {} }))
vi.mock('../hooks/useActiveStore', () => ({ useActiveStore: () => ({ storeId: 'store-a' }) }))
vi.mock('../hooks/useStorePreferences', () => {
  const preferences = { navigation: { industry: 'shop', enabledModules: ['sell'] } }
  return { useStorePreferences: () => ({ preferences }) }
})
vi.mock('./CustomerPortalShareCard', () => ({ default: () => null }))
vi.mock('firebase/firestore', () => {
  const read = (row: Row, path = ''): unknown => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], row)
  const evaluate = (q: TestQuery) => {
    fixture.queries.push(q)
    let rows: Row[] = q.path === 'sales' ? [...fixture.sales] : q.path === 'customers' ? [{ id: 'customer-a', storeId: 'store-a', name: 'Alice', email: 'alice@example.com', phone: '+233 123 456' }] : []
    for (const c of q.constraints ?? []) {
      if (c.kind === 'where') rows = rows.filter(row => {
        const value = read(row, c.field)
        if (c.op === '==') return value === c.value
        if (value == null) return false
        if (c.op === '>=') return Number(value) >= Number(c.value)
        if (c.op === '<') return Number(value) < Number(c.value)
        throw new Error(`Unsupported operator ${c.op}`)
      })
      if (c.kind === 'orderBy') rows = rows.filter(row => read(row, c.field) != null).sort((a, b) => (Number(read(a, c.field)) - Number(read(b, c.field))) * (c.value === 'desc' ? -1 : 1))
      if (c.kind === 'limit') rows = rows.slice(0, Number(c.value))
    }
    return { docs: rows.map(row => ({ id: row.id, data: () => row })), data: () => undefined }
  }
  return {
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
    orderBy: (field: string, value: string) => ({ kind: 'orderBy', field, value }),
    limit: (value: number) => ({ kind: 'limit', value }),
    query: (ref: TestQuery, ...constraints: Constraint[]) => ({ ...ref, constraints }),
    getDocs: async (q: TestQuery) => evaluate(q),
    onSnapshot: (q: TestQuery, callback: (snapshot: unknown) => void) => { callback(evaluate(q)); return fixture.unsubscribed },
    serverTimestamp: vi.fn(), setDoc: vi.fn(), addDoc: vi.fn(),
  }
})
beforeEach(() => { fixture.sales = []; fixture.queries = []; fixture.unsubscribed.mockClear() })

it('counts every sale today beyond historical caps, excluding voids and other stores', () => {
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  fixture.sales = [
    ...Array.from({ length: 250 }, (_, i) => ({ id: `old-${i}`, storeId: 'store-a', createdAt: yesterday, total: 100 })),
    ...Array.from({ length: 205 }, (_, i) => ({ id: `today-${i}`, storeId: 'store-a', createdAt: now, total: 10 })),
    { id: 'void', storeId: 'store-a', createdAt: now, total: 9000, status: 'voided' },
    { id: 'other-store', storeId: 'store-b', createdAt: now, total: 9000 },
  ]
  render(<MemoryRouter><CompactBusinessDashboard /></MemoryRouter>)
  const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(2050)
  expect(screen.getAllByText(money).length).toBeGreaterThan(0)
  const dashboardSalesQuery = fixture.queries.find(q => q.path === 'sales')
  expect(dashboardSalesQuery?.constraints?.some(c => c.kind === 'limit')).toBe(false)
})

it('retains supported legacy sale timestamps in today sales', () => {
  const now = new Date()
  fixture.sales = [
    { id: 'created', storeId: 'store-a', createdAt: now, total: 10 },
    { id: 'server', storeId: 'store-a', createdAtServer: now, total: 20 },
    { id: 'sale-date', storeId: 'store-a', saleDate: now, total: 30 },
    { id: 'updated', storeId: 'store-a', updatedAt: now, total: 40 },
  ]
  render(<MemoryRouter><CompactBusinessDashboard /></MemoryRouter>)
  const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(100)
  expect(screen.getAllByText(money).length).toBeGreaterThan(0)
})

it('keeps complete customer lifetime sales and orders nested customer queries before limiting', async () => {
  const now = new Date()
  fixture.sales = [
    ...Array.from({ length: 1100 }, (_, i) => ({ id: `unrelated-${i}`, storeId: 'store-a', customerId: 'unrelated', createdAt: now, total: 999 })),
    ...Array.from({ length: 105 }, (_, i) => ({ id: `canonical-${i}`, storeId: 'store-a', customerId: 'customer-a', createdAt: new Date(now.getTime() + i), total: 10 })),
    { id: 'nested-fallback-date', storeId: 'store-a', customer: { id: 'customer-a' }, createdAtServer: now, total: 7 },
    { id: 'both-paths', storeId: 'store-a', customerId: 'customer-a', customer: { id: 'customer-a' }, createdAt: new Date(now.getTime() + 200), total: 10 },
    { id: 'email', storeId: 'store-a', customer: { email: ' ALICE@EXAMPLE.COM ' }, total: 3 },
    { id: 'phone', storeId: 'store-a', customerPhone: '233123456', total: 4 },
    { id: 'void', storeId: 'store-a', customer: { id: 'customer-a' }, total: 9000, status: 'voided' },
    { id: 'other-store', storeId: 'store-b', customerId: 'customer-a', total: 9000 },
  ]
  render(<MemoryRouter initialEntries={['/customers/customer-a']}><Routes><Route path="/customers/:customerId" element={<CustomerCRM />} /></Routes></MemoryRouter>)
  expect(await screen.findByText(/109 transactions/)).toBeInTheDocument()
  const stats = screen.getByRole('region', { name: 'Customer CRM summary' })
  expect(within(stats).getByText('Lifetime sales')).toBeInTheDocument()
  const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(1074)
  expect(within(stats).getByText(money)).toBeInTheDocument()

  const nestedQuery = fixture.queries.find(q => q.path === 'sales' && q.constraints?.some(c => c.kind === 'where' && c.field === 'customer.id'))
  const nestedKinds = nestedQuery?.constraints?.map(c => `${c.kind}:${c.field ?? ''}`) ?? []
  expect(nestedKinds.indexOf('orderBy:createdAt')).toBeGreaterThan(-1)
  expect(nestedKinds.indexOf('limit:')).toBeGreaterThan(nestedKinds.indexOf('orderBy:createdAt'))
})
