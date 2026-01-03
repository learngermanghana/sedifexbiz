import { Client } from '@microsoft/microsoft-graph-client'
import { parseCsv } from './csv'

const EMPTY_WORKBOOK_BASE64 =
  'UEsDBBQAAAAIANBkI1x4zgjlQgEAACEEAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2TTU7DMBCF9z2F5W2VuGWBEEraBT9L6KIcwNiTxqpjWx63tLdn4kKRUEtAdBMrmjfvex6Nq/mus2wLEY13NZ+WE87AKa+NW9X8ZflY3HCGSTotrXdQ8z0gn89G1XIfABk1O6x5m1K4FQJVC53E0gdwVGl87GSi37gSQaq1XIG4mkyuhfIugUtF6j34bMRYdQ+N3NjEHnZUOWSJYJGzu4O2x9VchmCNkonqYuv0N1DxASmpM2uwNQHHJODiHKQvnmd8tT7TiKLRwBYypifZkVDsrHjzcf3q/br82edEVt80RoH2atNRS4khgtTYAqTOlvksO2nc+FcRsh5FPqYXznL0H46CaW8BLz2LbDoMT7R7cPj+fwTZZoBJ4kX0AWmdI/yd+LmsfXcRyAhiMoMXPULJ/d+3hP4daNAn8JXID3w2egdQSwMEFAAAAAgA0GQjXPGYBdTtAAAAVgIAAAsAAABfcmVscy8ucmVsc62SzU7DMAyA732KyPc13ZAQQk13mZB2Q2g8gEncH7WNo8RA9/ZESCCGGOzAMY79+bPlervMk3qhmAb2BtZlBYq8ZTf4zsDj4W51AyoJeocTezJwpATbpqgfaELJNakfQlIZ4pOBXiTcap1sTzOmkgP5/NNynFHyM3Y6oB2xI72pqmsdvzKgKZQ6waq9MxD3bg3qcAx0CZ7bdrC0Y/s8k5cfunzLyGSMHYmBZdKvHMcn5rHMUNBndTaX65yfVs8k6FBQW460CjFXRxnycj+NHNv7HE7vGX84Xf3nimgR8o7c71YYwodUrU+uoSneAFBLAwQUAAAACADQZCNch8LlHMcAAAAzAQAADwAAAHhsL3dvcmtib29rLnhtbI2PvW7DMAyEdz+FwL2R3aEoDNtZigKZ0z6AatGxEIs0SKU/b1/GQTqXC3kg7g5ft//Oi/tE0cTUQ7OrwSGNHBOdenh/e314BqclUAwLE/bwgwr7oeq+WM4fzGdnftIe5lLW1nsdZ8xBd7wi2WdiyaGYlJPXVTBEnRFLXvxjXT/5HBJB5f5my2rlP2k8TWnEFx4vGanc4gSXUIxD57QqDBbcbXU6bB034Shk4zhe78bYrvsQDR2ctMkOOcQG/Ob2d3vn77xD9QtQSwMEFAAAAAgA0GQjXNMnezjaAAAANwIAABoAAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc62Rz2rDMAyH73kKo/uipIMyRpxexqDX0T6AcZQ/NLGNpbXN29e0kK2wsR16Ej8ZffqQq815GtWRIg/eaSjzAhQ565vBdRr2u/enF1AsxjVm9I40zMSwqbPqg0YjaYb7IbBKEMcaepHwisi2p8lw7gO59NL6OBlJMXYYjD2YjnBVFGuM3xlQZ0rdYdW20RC3TQlqNwf6D9637WDpzdvPiZz8sAVPPh64J5IENbEj0bC0GK+lzBMV8Fef1SN9WOYxnXSRueU/DJ4faSBplr4ErvHWXA5R4d1319kFUEsDBBQAAAAIANBkI1yDzUlBiAAAAKIAAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sPcxLDsIwDATQfU4ReU9dWCCEknaDOAEcwGpMW9E4VRzxuT1RFyxnRvNc/4mLfXHWOYmHfdOCZRlSmGX0cL9ddyewWkgCLUnYw5cV+s64d8pPnZiLrYCoh6mU9Yyow8SRtEkrS10eKUcqNeYRdc1MYTvFBQ9te8RIs0BnrHVbfaFCWHH86535AVBLAwQUAAAACADQZCNcohrKOJUBAAB9AwAADQAAAHhsL3N0eWxlcy54bWylU01r4zAQvedXCN1bJWG3dBfbOSwEeuhSaAp7VSzZEejDSOMQ99d3xnLtBBZ66EmjpzfvPTRSsbs4y846JhN8yTf3a860r4Myvi3522F/98hZAumVtMHrkg868V21KhIMVr+etAaGCj6V/ATQ/RYi1SftZLoPnfZ40oToJOA2tiJ1UUuVqMlZsV2vH4STxvNqxVjRBA+J1aH3gDl4NQJVkd7ZWVpENlxURR1siAzQQRMJES+dzow/0ppjNAQ20hk7ZHhLwBhq4jnjQyRQZIdxSTmDsXbOsKUMCFRFJwF09HvcsKk+DB0m8HglWWnkfcFuoxw2259XDeOSrY8hKpzC9QVkqCqsbgB7omlPtELoBB0CBIeFMrINXlpS/eyYiqxca2tfaVr/mhv5S8N87/YOnlTJcex0DZ8lxprKrJQ3ZHGtNst/W5ldmluLa/XR7sZgRhmNv+R/6ZHZRYUde2PB+P/EzrLqsiQmAmEgj/iib7xQSelG9hYO82HJl/pZK9O7XzPrxZwDTKylzqwfZFOI5d9Uqw9QSwMEFAAAAAgA0GQjXHW0WeoYAgAAgAYAABMAAAB4bC90aGVtZS90aGVtZTEueG1stZTBbqMwEIbveQrL9xZIgSZRoGrYoD2stIdmH8AxhnhrDMJW07z9DlCIiVl1tVJzSGBmvv8fDxO2T++lQG+sUbySEfbuXYyYpFXGZRHhX4f0boWR0kRmRFSSRfjCFH6KF1uy0SdWMgS4VBsS4ZPW9cZxFIUwUfdVzSTk8qopiYbbpnCyhpxBthTO0nVDpyRcYiRJCao/85xThg6tJI4XCA36ewFfUqs21kWpaF5o52ySuM93FdmrF8OPuqhENOiNiAiDbVadD+xdYySI0pCIsNt9sBNvnR66Sgj9FwkDT7vPB94CZgfLDm+K48h7qb9+/Da6LSdudvl+v0/23qhulhNKYSKehfjpytsNDkPRLWY7JW7g+lPMdnuwsPVutwvWE+zBwnwLW7mh/7ycYL6FBfbZds9JEk6wwMJCC0sf16E/xUIDOwkuXy2o3YrxwfYlVySvxPdZagXUatimsarfWsdY23GR80rqTza5JL+rJoW6IdavC9FcIn2pWU4ocAkpjw0nYD2QzgzaynH5T3KCg96N3BTtzzj0fz1S+dmJci7Ei74I9kNNu1CV4FkK2W6wncg42voElx+TvdYZ3c2ptieTs1ZCojPsb7AMMKKkjnAOI4DLss4irGSBEREFvAupbnD8X611/1lpdmi3AloszxnVsz0aqXi8haLeycwaJvN6gB+L9EvmPqfbPY/S2Iw2cPMqH0Px4g9QSwMEFAAAAAgA0GQjXGpzHFc7AQAAggIAABEAAABkb2NQcm9wcy9jb3JlLnhtbJ2Sy2rDMBBF9/kKo70t24LUNbYDbcmqgUJSWrIT0iQRtR5Iap38fWXnUYdk1aV0zxzNDKpme9lGP2Cd0KpGWZKiCBTTXKhtjd5X87hAkfNUcdpqBTU6gEOzZlIxUzJt4c1qA9YLcFEQKVcyU6Od96bE2LEdSOqSQKgQbrSV1Iej3WJD2RfdAs7TdIoleMqpp7gXxuZiRJPoJOXsIjXfth0UnGFoQYLyDmdJhse0Byvd3ZIhuWKl8AcDd+FzOOL3TlzQruuSjgxwmCPDn4vX5TByLFS/MgaoCYUVZyWzQL22zRK42MC+wqO7HgnbbKnzi7D3jQD+dPgjb6Ojc5jkKAEehb7K4xzn5IM8v6zmqMnTfBqnWZySVZaXpChJnjwQkhdk3bdxpblSy9OL/3A/FiP32RM+Db75Nc3kF1BLAwQUAAAACADQZCNc9LyRbLcAAAAkAQAAEAAAAGRvY1Byb3BzL2FwcC54bWydzzFrwzAQhuHdv0JoT+RkKMHIDoE2W6FD0l1IZ1sg3wndNTj/PiqFtHPH44WH++xxXZK6QeFI2OvdttUK0FOIOPX6ejlvDlqxOAwuEUKv78D6ODT2o1CGIhFYVQG517NI7oxhP8PieFsz1jJSWZzUs0yGxjF6eCX/tQCK2bfti4FVAAOETX6CulE/ZneT/7KB/PeH/Hm55yoOlbSnnFP0TurS4T36QkyjqLfVQ7Lmb2ys+Z03NA9QSwECFAMUAAAACADQZCNceM4I5UIBAAAhBAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIANBkI1zxmAXU7QAAAFYCAAALAAAAAAAAAAAAAACAAXMBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIANBkI1yHwuUcxwAAADMBAAAPAAAAAAAAAAAAAACAAYkCAAB4bC93b3JrYm9vay54bWxQSwECFAMUAAAACADQZCNc0yd7ONoAAAA3AgAAGgAAAAAAAAAAAAAAgAF9AwAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECFAMUAAAACADQZCNcg81JQYgAAACiAAAAGAAAAAAAAAAAAAAAgAGPBAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsBAhQDFAAAAAgA0GQjXKIayjiVAQAAfQMAAA0AAAAAAAAAAAAAAIABTQUAAHhsL3N0eWxlcy54bWxQSwECFAMUAAAACADQZCNcdbRZ6hgCAACABgAAEwAAAAAAAAAAAAAAgAENBwAAeGwvdGhlbWUvdGhlbWUxLnhtbFBLAQIUAxQAAAAIANBkI1xqcxxXOwEAAIICAAARAAAAAAAAAAAAAACAAVYJAABkb2NQcm9wcy9jb3JlLnhtbFBLAQIUAxQAAAAIANBkI1z0vJFstwAAACQBAAAQAAAAAAAAAAAAAACAAcAKAABkb2NQcm9wcy9hcHAueG1sUEsFBgAAAAAJAAkAPgIAAKULAAAAAA=='

const EXCEL_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function createGraphClient(accessToken: string) {
  return Client.init({
    authProvider: done => {
      done(null, accessToken)
    },
  })
}

function base64ToUint8Array(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function isNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      (error as { statusCode?: number }).statusCode === 404
  )
}

function columnIndexToLetter(index: number) {
  let result = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    current = Math.floor((current - 1) / 26)
  }
  return result
}

function buildFallbackHeaders(rowCount: number) {
  return Array.from({ length: rowCount }, (_, index) => `Column ${index + 1}`)
}

async function ensureWorkbookExists(client: ReturnType<typeof createGraphClient>, workbookName: string) {
  try {
    await client.api(`/me/drive/root:/${workbookName}`).get()
    return
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }

  const bytes = base64ToUint8Array(EMPTY_WORKBOOK_BASE64)
  const content = new Blob([bytes], { type: EXCEL_MIME_TYPE })

  await client
    .api(`/me/drive/root:/${workbookName}:/content`)
    .header('Content-Type', EXCEL_MIME_TYPE)
    .put(content)
}

async function fetchTable(
  client: ReturnType<typeof createGraphClient>,
  workbookName: string,
  tableName: string,
) {
  try {
    return await client
      .api(`/me/drive/root:/${workbookName}:/workbook/tables/${tableName}`)
      .get()
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }
}

async function ensureTableExists(
  client: ReturnType<typeof createGraphClient>,
  workbookName: string,
  tableName: string,
  headerRow: string[],
) {
  const existing = await fetchTable(client, workbookName, tableName)
  if (existing) {
    return existing
  }

  const headerCells = headerRow.length > 0 ? headerRow : buildFallbackHeaders(1)
  const lastColumn = columnIndexToLetter(headerCells.length)
  const tableAddress = `A1:${lastColumn}1`

  await client
    .api(
      `/me/drive/root:/${workbookName}:/workbook/worksheets('Sheet1')/range(address='${tableAddress}')`,
    )
    .patch({ values: [headerCells] })

  const table = await client
    .api(`/me/drive/root:/${workbookName}:/workbook/worksheets('Sheet1')/tables/add`)
    .post({ address: tableAddress, hasHeaders: true })

  if (table?.name !== tableName && table?.id) {
    await client
      .api(`/me/drive/root:/${workbookName}:/workbook/tables/${table.id}`)
      .patch({ name: tableName })
  }

  return table
}

export function csvToRows(csv: string): string[][] {
  return parseCsv(csv)
}

export async function addRowsToExcelTable(
  accessToken: string,
  workbookName: string,
  tableName: string,
  values: string[][],
  headerRow: string[] = [],
): Promise<void> {
  if (values.length === 0 && headerRow.length === 0) {
    return
  }

  const client = createGraphClient(accessToken)
  await ensureWorkbookExists(client, workbookName)

  const headers = headerRow.length > 0 ? headerRow : buildFallbackHeaders(values[0]?.length ?? 1)
  await ensureTableExists(client, workbookName, tableName, headers)

  if (values.length === 0) {
    return
  }

  const url = `/me/drive/root:/${workbookName}:/workbook/tables/${tableName}/rows/add`
  await client.api(url).post({ index: null, values })
}
