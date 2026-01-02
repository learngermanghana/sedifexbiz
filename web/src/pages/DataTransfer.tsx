import React, { useMemo, useState } from 'react'
import PageSection from '../layout/PageSection'
import './DataTransfer.css'

type HeaderSpec = {
  key: string
  description: string
}

function buildCsv(headers: string[], rows: string[][]) {
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function DataTransfer() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const itemRequired: HeaderSpec[] = [
    { key: 'name', description: 'Item name as it appears on receipts.' },
    { key: 'price', description: 'Selling price (number). Example: 25.5' },
  ]
  const itemOptional: HeaderSpec[] = [
    { key: 'sku', description: 'SKU or internal code.' },
    { key: 'barcode', description: 'Digits-only barcode for scanning.' },
    { key: 'stock_count', description: 'Current stock quantity.' },
    { key: 'reorder_point', description: 'Restock alert level.' },
    { key: 'item_type', description: 'product, service, or made_to_order.' },
    { key: 'tax_rate', description: 'Tax rate as 7.5 or 0.075.' },
    { key: 'expiry_date', description: 'Use YYYY-MM-DD.' },
    { key: 'manufacturer_name', description: 'Brand or manufacturer name.' },
    { key: 'production_date', description: 'Use YYYY-MM-DD.' },
    { key: 'batch_number', description: 'Batch or lot code.' },
    { key: 'show_on_receipt', description: 'true or false.' },
  ]

  const customerRequired: HeaderSpec[] = [
    { key: 'name', description: 'Primary customer name.' },
  ]
  const customerOptional: HeaderSpec[] = [
    { key: 'display_name', description: 'Preferred display name.' },
    { key: 'phone', description: 'Phone number with country code if available.' },
    { key: 'email', description: 'Customer email address.' },
    { key: 'notes', description: 'Notes or preferences.' },
    { key: 'tags', description: 'Comma-separated tags.' },
  ]

  const itemTemplate = useMemo(
    () =>
      buildCsv(
        [
          'name',
          'sku',
          'barcode',
          'price',
          'stock_count',
          'reorder_point',
          'item_type',
          'tax_rate',
          'expiry_date',
          'manufacturer_name',
          'production_date',
          'batch_number',
          'show_on_receipt',
        ],
        [
          [
            'Classic Rice 5kg',
            'RICE-5K',
            '1234567890123',
            '125.00',
            '20',
            '5',
            'product',
            '7.5',
            '2026-06-30',
            'Sedifex Mills',
            '2024-06-01',
            'BATCH-01',
            'true',
          ],
        ],
      ),
    [],
  )

  const customerTemplate = useMemo(
    () =>
      buildCsv(
        ['name', 'display_name', 'phone', 'email', 'notes', 'tags'],
        [
          [
            'Ama Mensah',
            'Ama M.',
            '+233555123456',
            'ama@example.com',
            'Prefers SMS updates',
            'vip,loyalty',
          ],
        ],
      ),
    [],
  )

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
  }

  return (
    <PageSection
      title="Data transfer"
      subtitle="Import data from another website or export your Sedifex records with CSV files."
    >
      <div className="data-transfer__grid">
        <section className="card data-transfer__card">
          <h3>Import CSV</h3>
          <p className="data-transfer__muted">
            Upload a CSV file with the headers below to migrate your items and customers.
          </p>
          <div className="data-transfer__upload">
            <input
              className="data-transfer__file-input"
              id="data-transfer-upload"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
            />
            <label className="button button--outline" htmlFor="data-transfer-upload">
              Choose CSV file
            </label>
            <span className="data-transfer__file-name">
              {selectedFile ? selectedFile.name : 'No file selected'}
            </span>
          </div>
          <div className="data-transfer__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => downloadCsv('sedifex-items-import-template.csv', itemTemplate)}
            >
              Download items template
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => downloadCsv('sedifex-customers-import-template.csv', customerTemplate)}
            >
              Download customers template
            </button>
          </div>
        </section>

        <section className="card data-transfer__card">
          <h3>Export CSV</h3>
          <p className="data-transfer__muted">
            Export files keep the same headers, so you can re-import later without edits.
          </p>
          <div className="data-transfer__actions data-transfer__actions--stacked">
            <button
              type="button"
              className="button button--primary"
              onClick={() => downloadCsv('sedifex-items-export.csv', itemTemplate)}
            >
              Download items CSV
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => downloadCsv('sedifex-customers-export.csv', customerTemplate)}
            >
              Download customers CSV
            </button>
          </div>
          <p className="data-transfer__hint">
            Tip: Keep headers lowercase with underscores exactly as shown.
          </p>
        </section>
      </div>

      <div className="data-transfer__guide">
        <section className="card data-transfer__card">
          <h3>Items CSV headers</h3>
          <div className="data-transfer__header-group">
            <div>
              <h4>Required</h4>
              <ul className="data-transfer__header-list">
                {itemRequired.map(header => (
                  <li key={header.key}>
                    <span className="data-transfer__header-key">{header.key}</span>
                    <span className="data-transfer__header-desc">{header.description}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Optional</h4>
              <ul className="data-transfer__header-list">
                {itemOptional.map(header => (
                  <li key={header.key}>
                    <span className="data-transfer__header-key">{header.key}</span>
                    <span className="data-transfer__header-desc">{header.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="card data-transfer__card">
          <h3>Customers CSV headers</h3>
          <div className="data-transfer__header-group">
            <div>
              <h4>Required</h4>
              <ul className="data-transfer__header-list">
                {customerRequired.map(header => (
                  <li key={header.key}>
                    <span className="data-transfer__header-key">{header.key}</span>
                    <span className="data-transfer__header-desc">{header.description}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Optional</h4>
              <ul className="data-transfer__header-list">
                {customerOptional.map(header => (
                  <li key={header.key}>
                    <span className="data-transfer__header-key">{header.key}</span>
                    <span className="data-transfer__header-desc">{header.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </PageSection>
  )
}
