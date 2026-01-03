// functions/src/utils/pdf.ts

/**
 * Very lightweight helper. Returns a string; the caller wraps it in Buffer.
 * This will download as a .pdf file but will just contain plain text.
 */
export function buildSimplePdf(title: string, lines: string[]): string {
  const body = [title, '', ...lines].join('\n')
  return body
}
