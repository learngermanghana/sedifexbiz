import { describe, expect, it } from 'vitest'
import { mapSale } from './PosSalesReport'

describe('mapSale', () => {
  it('shows the names and quantities of items in a sale', () => {
    const sale = mapSale('sale-1', {
      items: [
        { name: 'Coffee', qty: 2 },
        { productName: 'Bread', quantity: 1 },
      ],
      total: 45,
    })

    expect(sale.itemsSummary).toBe('Coffee × 2, Bread × 1')
    expect(sale.unitsSold).toBe(3)
  })

  it('keeps older sales without item details readable', () => {
    expect(mapSale('legacy-sale', { total: 10 }).itemsSummary).toBe('No item details')
  })
})
