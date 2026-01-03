// web/src/utils/excel.ts
import { Client } from '@microsoft/microsoft-graph-client';

export async function addRowsToExcel(
  accessToken: string,
  workbookName: string,
  tableName: string,
  values: string[][],
): Promise<void> {
  const client = Client.init({
    authProvider: done => {
      done(null, accessToken);
    },
  });

  // Build the request URL; this stores the workbook in the signed‑in user’s OneDrive root.
  const url = `/me/drive/root:/${workbookName}:/workbook/tables/${tableName}/rows/add`;
  await client.api(url).post({ index: null, values });
}

/**
 * Converts a CSV string into a 2‑D array of cell values.
 * You can reuse the existing parseCsv() in web/src/utils/csv.ts instead.
 */
export function csvToTableRows(csv: string): string[][] {
  return csv
    .split('\n')
    .slice(1) // drop header row
    .map(line => line.split(','));
}
