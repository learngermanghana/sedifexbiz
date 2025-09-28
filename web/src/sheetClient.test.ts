import { describe, expect, it, vi } from 'vitest'

import { fetchSheetRows, findUserRow } from './sheetClient'

const wrapGviz = (payload: unknown) => JSON.stringify(payload)

describe('sheetClient', () => {
  it('matches emails regardless of surrounding whitespace in the roster', async () => {
    const payload = {
      table: {
        cols: [{ label: 'Email' }],
        rows: [
          {
            c: [
              {
                v: '  Person@Example.com  ',
              },
            ],
          },
        ],
      },
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => wrapGviz(payload),
    } as Response)

    const rows = await fetchSheetRows()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('person@example.com')

    const found = findUserRow(rows, ' PERSON@EXAMPLE.COM ')
    expect(found).toBe(rows[0])

    fetchSpy.mockRestore()
  })
})
