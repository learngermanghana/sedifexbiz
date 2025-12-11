import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildReceiptPdf } from './receipt'
import { buildSimplePdf } from './pdf'

vi.mock('./pdf', () => ({
  buildSimplePdf: vi.fn(() => new Uint8Array([1, 2, 3])),
}))

const mockCreateObjectURL = vi.fn(() => 'blob:url')
const mockedBuildSimplePdf = vi.mocked(buildSimplePdf)

beforeEach(() => {
  mockCreateObjectURL.mockClear()
  mockedBuildSimplePdf.mockClear()
  // @ts-expect-error jsdom URL override
  global.URL.createObjectURL = mockCreateObjectURL
})

describe('buildReceiptPdf', () => {
  it('includes receipt metadata when provided on lines', () => {
    const result = buildReceiptPdf({
      saleId: 'sale-123',
      items: [
        {
          name: 'Pain Relief Gel',
          qty: 2,
          price: 40,
          metadata: ['Manufacturer: ACME Labs', 'Batch: B-100'],
        },
      ],
      totals: { subTotal: 80, taxTotal: 0, discount: 0, total: 80 },
      paymentMethod: 'cash',
      discountInput: '',
      companyName: 'HealthCo',
      customerName: 'Jane Doe',
    })

    expect(result).not.toBeNull()
    expect(buildSimplePdf).toHaveBeenCalledWith(
      'Sale receipt',
      expect.arrayContaining([
        expect.stringContaining('• 2 x Pain Relief Gel'),
        '   - Manufacturer: ACME Labs',
        '   - Batch: B-100',
      ]),
    )
    expect(mockCreateObjectURL).toHaveBeenCalled()
  })
})
