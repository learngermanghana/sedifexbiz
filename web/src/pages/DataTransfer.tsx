import React, { useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import PageSection from '../layout/PageSection'
import './DataTransfer.css'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'

// NEW: Microsoft Graph helpers
import {
  signInWithMicrosoft,
  acquireGraphToken,
} from '../utils/msalClient'
import {
  csvToRows,
  addRowsToExcelTable,
  fetchExcelTableRows,
} from '../utils/excel'

type HeaderSpec = {
  key: string
  description: string
}

type CsvHeaderIndex = Record<string, number>

type CsvHeaderValidation = {
  itemsMissing: string[]
  customersMissing: string[]
  error?: string
}

type ActionStatusTone = 'info' | 'success' | 'error'

type ActionStatus = {
  tone: ActionStatusTone
  message: string
}

const ITEM_REQUIRED_HEADERS: HeaderSpec[] = [
  { key: 'name', description: 'Item name as it appears on receipts.' },
  { key: 'price', description: 'Selling price (number). Example: 25.5' },
]
const ITEM_OPTIONAL_HEADERS: HeaderSpec[] = [
  { key: 'sku', description: 'SKU or internal code.' },
  { key: 'barcode', description: 'Barcode for scanning (letters + digits are supported).' },
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
const CUSTOMER_REQUIRED_HEADERS: HeaderSpec[] = [
  { key: 'name', description: 'Primary customer name.' },
]
const CUSTOMER_OPTIONAL_HEADERS: HeaderSpec[] = [
  { key: 'display_name', description: 'Preferred display name.' },
  { key: 'phone', description: 'Phone number with country code if available.' },
  { key: 'email', description: 'Customer email address.' },
  { key: 'birthdate', description: 'Customer birthdate (YYYY-MM-DD).' },
  { key: 'notes', description: 'Notes or preferences.' },
  { key: 'tags', description: 'Comma-separated tags.' },
]
const ITEM_REQUIRED_KEYS = ITEM_REQUIRED_HEADERS.map(header => header.key)
const CUSTOMER_REQUIRED_KEYS = CUSTOMER_REQUIRED_HEADERS.map(header => header.key)
const AFRICAN_COUNTRY_CODES = [
  '233',
  '234',
  '225',
  '221',
  '237',
  '254',
  '255',
  '256',
  '250',
  '251',
  '260',
  '263',
  '27',
  '20',
  '212',
  '213',
  '216',
]

function parseTaxRateInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed > 1 ? parsed / 100 : parsed
}

function buildCsvValue(value: string) {
  const needsQuotes = value.includes(',') || value.includes('"') || value.includes('\n')
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

function buildCsv(headers: string[], rows: string[][]) {
  return [
    headers.map(buildCsvValue).join(','),
    ...rows.map(row => row.map(buildCsvValue).join(',')),
  ].join('\n')
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

function buildCsvFromRows(headers: string[], rows: string[][]) {
  if (headers.length === 0 && rows.length === 0) {
    return ''
  }

  const normalizedHeaders =
    headers.length > 0 ? headers : rows[0]?.map((_, index) => `Column ${index + 1}`)
  return buildCsv(normalizedHeaders ?? [], rows)
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase()
}

function normalizePhoneNumber(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  const hasPlusPrefix = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (!digits) return ''

  if (hasPlusPrefix) return `+${digits}`

  if (trimmed.startsWith('00')) {
    return `+${digits.replace(/^00/, '')}`
  }

  if (trimmed.startsWith('0')) {
    return `+233${digits.replace(/^0/, '')}`
  }

  const matchesAfricanCode = AFRICAN_COUNTRY_CODES.some(code => digits.startsWith(code))
  if (matchesAfricanCode) {
    return `+${digits}`
  }

  return `+${digits}`
}

function buildPhoneKey(value: string): string {
  if (!value) return ''
  return normalizePhoneNumber(value).replace(/\D/g, '')
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate()
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function formatDateForCsv(value: unknown): string {
  const parsed = normalizeDate(value)
  return parsed ? parsed.toISOString().slice(0, 10) : ''
}

function formatTaxRate(value: unknown): string {
  const parsed = normalizeNumber(value)
  if (parsed === null) return ''
  if (parsed > 1) return `${parsed}`
  return `${(parsed * 100).toString()}`
}

function normalizeBirthdateInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  const normalized = new Date(parsed)
  return Number.isNaN(normalized.getTime()) ? null : normalized.toISOString().slice(0, 10)
}

function buildHeaderIndex(headers: string[]): CsvHeaderIndex {
  return headers.reduce<CsvHeaderIndex>((acc, header, index) => {
    acc[header.trim().toLowerCase()] = index
    return acc
  }, {})
}

function getRowValue(row: string[], headerIndex: CsvHeaderIndex, key: string) {
  const index = headerIndex[key]
  if (index === undefined) return ''
  return row[index] ?? ''
}

export default function DataTransfer() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [headerValidation, setHeaderValidation] = useState<CsvHeaderValidation | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { storeId: activeStoreId, isLoading: isStoreLoading } = useActiveStore()

  // NEW: loading flags for Excel exports
  const [isItemsExcelExporting, setIsItemsExcelExporting] = useState(false)
  const [isCustomersExcelExporting, setIsCustomersExcelExporting] = useState(false)
  const [isItemsExcelImporting, setIsItemsExcelImporting] = useState(false)
  const [isCustomersExcelImporting, setIsCustomersExcelImporting] = useState(false)
  const [isItemsCsvExporting, setIsItemsCsvExporting] = useState(false)
  const [isCustomersCsvExporting, setIsCustomersCsvExporting] = useState(false)
  const [isItemsCsvImporting, setIsItemsCsvImporting] = useState(false)
  const [isCustomersCsvImporting, setIsCustomersCsvImporting] = useState(false)
  const [itemsCsvExportStatus, setItemsCsvExportStatus] = useState<ActionStatus | null>(null)
  const [customersCsvExportStatus, setCustomersCsvExportStatus] = useState<ActionStatus | null>(null)
  const [itemsCsvImportStatus, setItemsCsvImportStatus] = useState<ActionStatus | null>(null)
  const [customersCsvImportStatus, setCustomersCsvImportStatus] = useState<ActionStatus | null>(null)
  const [itemsExcelExportStatus, setItemsExcelExportStatus] = useState<ActionStatus | null>(null)
  const [customersExcelExportStatus, setCustomersExcelExportStatus] = useState<ActionStatus | null>(null)
  const [itemsExcelImportStatus, setItemsExcelImportStatus] = useState<ActionStatus | null>(null)
  const [customersExcelImportStatus, setCustomersExcelImportStatus] = useState<ActionStatus | null>(null)

  const itemRequired = ITEM_REQUIRED_HEADERS
  const itemOptional = ITEM_OPTIONAL_HEADERS
  const customerRequired = CUSTOMER_REQUIRED_HEADERS
  const customerOptional = CUSTOMER_OPTIONAL_HEADERS

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

  const validationSummary = useMemo(() => {
    if (!headerValidation || headerValidation.error) return null
    const itemsValid = headerValidation.itemsMissing.length === 0
    const customersValid = headerValidation.customersMissing.length === 0
    if (itemsValid && customersValid) {
      return 'Headers look good for items and customers.'
    }
    if (itemsValid) {
      return 'Headers look good for items.'
    }
    if (customersValid) {
      return 'Headers look good for customers.'
    }
    return null
  }, [headerValidation])

  useEffect(() => {
    if (!selectedFile) {
      setHeaderValidation(null)
      return
    }

    let isActive = true

    const validateHeaders = async () => {
      try {
        const text = await selectedFile.text()
        const rows = csvToRows(text)
        if (!rows.length) {
          if (isActive) {
            setHeaderValidation({
              itemsMissing: [...ITEM_REQUIRED_KEYS],
              customersMissing: [...CUSTOMER_REQUIRED_KEYS],
              error: 'No rows detected in the CSV file.',
            })
          }
          return
        }

        const [headerRow] = rows
        const headerIndex = buildHeaderIndex(headerRow)
        const itemsMissing = ITEM_REQUIRED_KEYS.filter(key => headerIndex[key] === undefined)
        const customersMissing = CUSTOMER_REQUIRED_KEYS.filter(key => headerIndex[key] === undefined)

        if (isActive) {
          setHeaderValidation({ itemsMissing, customersMissing })
        }
      } catch (error) {
        if (isActive) {
          setHeaderValidation({
            itemsMissing: [],
            customersMissing: [],
            error: 'Unable to read CSV headers.',
          })
        }
      }
    }

    validateHeaders()

    return () => {
      isActive = false
    }
  }, [selectedFile])

  const customerTemplate = useMemo(
    () =>
      buildCsv(
        ['name', 'display_name', 'phone', 'email', 'birthdate', 'notes', 'tags'],
        [
          [
            'Ama Mensah',
            'Ama M.',
            '+233555123456',
            'ama@example.com',
            '1993-08-12',
            'Prefers SMS updates',
            'vip,loyalty',
          ],
        ],
      ),
    [],
  )

  async function handleDownloadItemsCsv() {
    try {
      setIsItemsCsvExporting(true)
      setItemsCsvExportStatus({ tone: 'info', message: 'Exporting items CSV…' })

      if (isStoreLoading) {
        setItemsCsvExportStatus({
          tone: 'error',
          message: 'Loading your store data. Please try again in a moment.',
        })
        return
      }
      if (!activeStoreId) {
        setItemsCsvExportStatus({
          tone: 'error',
          message: 'Select a store before downloading items.',
        })
        return
      }

      const snapshot = await getDocs(
        query(collection(db, 'products'), where('storeId', '==', activeStoreId)),
      )
      const rows = snapshot.docs.map(docSnap => {
        const data = docSnap.data() as Record<string, unknown>
        const name = normalizeText(data.name)
        const sku = normalizeText(data.sku)
        const barcode = normalizeText(data.barcode ?? data.sku)
        const price = normalizeNumber(data.price)
        const stockCount = normalizeNumber(data.stockCount)
        const reorderPoint = normalizeNumber(
          data.reorderPoint ?? data.reorderLevel ?? (data as any).reorderThreshold,
        )
        const itemType =
          data.itemType === 'service'
            ? 'service'
            : data.itemType === 'made_to_order'
              ? 'made_to_order'
              : 'product'
        const taxRate = formatTaxRate(data.taxRate)
        const expiryDate = formatDateForCsv(data.expiryDate)
        const manufacturerName = normalizeText(data.manufacturerName)
        const productionDate = formatDateForCsv(data.productionDate)
        const batchNumber = normalizeText(data.batchNumber)
        const showOnReceipt =
          data.showOnReceipt === true ? 'true' : data.showOnReceipt === false ? 'false' : ''

        return [
          name,
          sku,
          barcode,
          price === null ? '' : price.toString(),
          stockCount === null ? '' : stockCount.toString(),
          reorderPoint === null ? '' : reorderPoint.toString(),
          itemType,
          taxRate,
          expiryDate,
          manufacturerName,
          productionDate,
          batchNumber,
          showOnReceipt,
        ]
      })

      if (!rows.length) {
        setItemsCsvExportStatus({ tone: 'info', message: 'No items found to export.' })
        return
      }

      const headers = [
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
      ]
      downloadCsv('sedifex-items-export.csv', buildCsv(headers, rows))
      setItemsCsvExportStatus({ tone: 'success', message: 'Items CSV downloaded.' })
    } catch (error) {
      console.error('Failed to export items CSV', error)
      setItemsCsvExportStatus({
        tone: 'error',
        message: 'Failed to export items CSV. Please check the console for details.',
      })
    } finally {
      setIsItemsCsvExporting(false)
    }
  }

  async function handleDownloadCustomersCsv() {
    try {
      setIsCustomersCsvExporting(true)
      setCustomersCsvExportStatus({ tone: 'info', message: 'Exporting customers CSV…' })

      if (isStoreLoading) {
        setCustomersCsvExportStatus({
          tone: 'error',
          message: 'Loading your store data. Please try again in a moment.',
        })
        return
      }
      if (!activeStoreId) {
        setCustomersCsvExportStatus({
          tone: 'error',
          message: 'Select a store before downloading customers.',
        })
        return
      }

      const snapshot = await getDocs(
        query(collection(db, 'customers'), where('storeId', '==', activeStoreId)),
      )

      const rows = snapshot.docs.map(docSnap => {
        const data = docSnap.data() as Record<string, unknown>
        const displayName = normalizeText(data.displayName)
        const name = normalizeText(data.name) || displayName
        const phone = normalizeText(data.phone)
        const email = normalizeText(data.email)
        const birthdate = formatDateForCsv(data.birthdate)
        const notes = normalizeText(data.notes)
        const tags = Array.isArray(data.tags)
          ? data.tags.map(tag => normalizeText(tag)).filter(Boolean).join(', ')
          : ''

        return [name, displayName, phone, email, birthdate, notes, tags]
      })

      if (!rows.length) {
        setCustomersCsvExportStatus({ tone: 'info', message: 'No customers found to export.' })
        return
      }

      const headers = ['name', 'display_name', 'phone', 'email', 'birthdate', 'notes', 'tags']
      downloadCsv('sedifex-customers-export.csv', buildCsv(headers, rows))
      setCustomersCsvExportStatus({ tone: 'success', message: 'Customers CSV downloaded.' })
    } catch (error) {
      console.error('Failed to export customers CSV', error)
      setCustomersCsvExportStatus({
        tone: 'error',
        message: 'Failed to export customers CSV. Please check the console for details.',
      })
    } finally {
      setIsCustomersCsvExporting(false)
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
  }

  function clearSelectedFile() {
    setSelectedFile(null)
    setHeaderValidation(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleImportItemsFromCsv() {
    if (!selectedFile) {
      setItemsCsvImportStatus({
        tone: 'error',
        message: 'Choose a CSV file before importing items.',
      })
      return
    }
    if (isStoreLoading) {
      setItemsCsvImportStatus({
        tone: 'error',
        message: 'Loading your store data. Please try again in a moment.',
      })
      return
    }
    if (!activeStoreId) {
      setItemsCsvImportStatus({
        tone: 'error',
        message: 'Select a store before importing items.',
      })
      return
    }

    try {
      setIsItemsCsvImporting(true)
      setItemsCsvImportStatus({ tone: 'info', message: 'Importing items from CSV…' })
      const text = await selectedFile.text()
      const rows = csvToRows(text)
      if (!rows.length) {
        throw new Error('No rows detected in the CSV file.')
      }

      const [headerRow, ...dataRows] = rows
      const headerIndex = buildHeaderIndex(headerRow)
      const requiredHeaders = itemRequired.map(header => header.key)
      const missingHeaders = requiredHeaders.filter(key => headerIndex[key] === undefined)
      if (missingHeaders.length) {
        throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`)
      }

      const existingItemsSnapshot = await getDocs(
        query(collection(db, 'products'), where('storeId', '==', activeStoreId)),
      )
      const existingItemsByBarcode = new Map<string, string>()
      const existingItemsBySku = new Map<string, string>()
      const existingItemsByName = new Map<string, string>()

      const trackItemKeys = (id: string, values: { name?: string; barcode?: string; sku?: string }) => {
        const nameKey = normalizeKey(values.name)
        const barcodeKey = normalizeKey(values.barcode)
        const skuKey = normalizeKey(values.sku)
        if (nameKey) {
          existingItemsByName.set(nameKey, id)
        }
        if (barcodeKey) {
          existingItemsByBarcode.set(barcodeKey, id)
        }
        if (skuKey) {
          existingItemsBySku.set(skuKey, id)
        }
      }

      existingItemsSnapshot.forEach(docSnap => {
        const data = docSnap.data() as Record<string, unknown>
        trackItemKeys(docSnap.id, {
          name: normalizeText(data.name),
          barcode: normalizeText(data.barcode),
          sku: normalizeText(data.sku),
        })
      })

      const shouldSetSku = headerIndex.sku !== undefined
      const shouldSetBarcode = headerIndex.barcode !== undefined
      const shouldSetStockCount = headerIndex.stock_count !== undefined
      const shouldSetReorderPoint = headerIndex.reorder_point !== undefined
      const shouldSetTaxRate = headerIndex.tax_rate !== undefined
      const shouldSetExpiryDate = headerIndex.expiry_date !== undefined
      const shouldSetManufacturerName = headerIndex.manufacturer_name !== undefined
      const shouldSetProductionDate = headerIndex.production_date !== undefined
      const shouldSetBatchNumber = headerIndex.batch_number !== undefined
      const shouldSetShowOnReceipt = headerIndex.show_on_receipt !== undefined

      let importedCount = 0
      let skippedCount = 0
      let updatedCount = 0

      for (const row of dataRows) {
        if (!row.length || row.every(cell => !cell.trim())) {
          continue
        }
        const name = normalizeText(getRowValue(row, headerIndex, 'name'))
        const priceInput = getRowValue(row, headerIndex, 'price')
        const price = normalizeNumber(priceInput)
        if (!name || price === null) {
          skippedCount += 1
          continue
        }

        const rawItemType = normalizeText(getRowValue(row, headerIndex, 'item_type')).toLowerCase()
        const itemType =
          rawItemType === 'service'
            ? 'service'
            : rawItemType === 'made_to_order'
              ? 'made_to_order'
              : 'product'
        const sku = normalizeText(getRowValue(row, headerIndex, 'sku'))
        const barcodeValue = normalizeText(getRowValue(row, headerIndex, 'barcode'))
        const barcode = barcodeValue || sku
        const stockCount = normalizeNumber(getRowValue(row, headerIndex, 'stock_count'))
        const reorderPoint = normalizeNumber(getRowValue(row, headerIndex, 'reorder_point'))
        const taxRate = parseTaxRateInput(getRowValue(row, headerIndex, 'tax_rate'))
        const expiryDate = normalizeDate(getRowValue(row, headerIndex, 'expiry_date'))
        const manufacturerName = normalizeText(getRowValue(row, headerIndex, 'manufacturer_name'))
        const productionDate = normalizeDate(getRowValue(row, headerIndex, 'production_date'))
        const batchNumber = normalizeText(getRowValue(row, headerIndex, 'batch_number'))
        const showOnReceiptValue = normalizeText(
          getRowValue(row, headerIndex, 'show_on_receipt'),
        ).toLowerCase()
        const showOnReceipt =
          showOnReceiptValue === 'true'
            ? true
            : showOnReceiptValue === 'false'
              ? false
              : null

        const itemLookupKeys = {
          name: normalizeKey(name),
          barcode: normalizeKey(barcode),
          sku: normalizeKey(sku),
        }
        const existingId =
          (itemLookupKeys.barcode && existingItemsByBarcode.get(itemLookupKeys.barcode)) ||
          (itemLookupKeys.sku && existingItemsBySku.get(itemLookupKeys.sku)) ||
          (itemLookupKeys.name && existingItemsByName.get(itemLookupKeys.name))

        const payload: Record<string, unknown> = {
          storeId: activeStoreId,
          name,
          itemType,
          price,
          updatedAt: serverTimestamp(),
        }
        const isNewItem = !existingId

        if (isNewItem) {
          payload.createdAt = serverTimestamp()
        }

        const setField = (shouldSet: boolean, key: string, value: unknown) => {
          if (isNewItem || shouldSet) {
            payload[key] = value
          }
        }

        setField(shouldSetSku, 'sku', itemType === 'service' ? null : sku || null)
        setField(shouldSetBarcode, 'barcode', itemType === 'service' ? null : barcode || null)
        setField(shouldSetStockCount, 'stockCount', itemType === 'product' ? stockCount : null)
        setField(shouldSetReorderPoint, 'reorderPoint', itemType === 'product' ? reorderPoint : null)
        setField(shouldSetTaxRate, 'taxRate', taxRate)
        setField(shouldSetExpiryDate, 'expiryDate', itemType === 'product' ? expiryDate : null)
        setField(
          shouldSetManufacturerName,
          'manufacturerName',
          itemType === 'service' ? null : manufacturerName || null,
        )
        setField(
          shouldSetProductionDate,
          'productionDate',
          itemType === 'service' ? null : productionDate,
        )
        setField(
          shouldSetBatchNumber,
          'batchNumber',
          itemType === 'service' ? null : batchNumber || null,
        )
        setField(
          shouldSetShowOnReceipt,
          'showOnReceipt',
          itemType === 'service' ? false : showOnReceipt ?? false,
        )

        if (existingId) {
          await updateDoc(doc(db, 'products', existingId), payload)
          updatedCount += 1
          trackItemKeys(existingId, { name, barcode, sku })
        } else {
          const docRef = await addDoc(collection(db, 'products'), payload)
          importedCount += 1
          trackItemKeys(docRef.id, { name, barcode, sku })
        }
      }

      if (!importedCount && !updatedCount) {
        throw new Error('No valid item rows were found in this file.')
      }

      setItemsCsvImportStatus({
        tone: 'success',
        message: `Imported ${importedCount + updatedCount} items (${importedCount} new, ${updatedCount} updated)${
          skippedCount ? `, ${skippedCount} skipped.` : '.'
        }`,
      })
      clearSelectedFile()
    } catch (error) {
      console.error('Failed to import items CSV', error)
      setItemsCsvImportStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to import items CSV. Please check the console for details.',
      })
    } finally {
      setIsItemsCsvImporting(false)
    }
  }

  async function handleImportCustomersFromCsv() {
    if (!selectedFile) {
      setCustomersCsvImportStatus({
        tone: 'error',
        message: 'Choose a CSV file before importing customers.',
      })
      return
    }
    if (isStoreLoading) {
      setCustomersCsvImportStatus({
        tone: 'error',
        message: 'Loading your store data. Please try again in a moment.',
      })
      return
    }
    if (!activeStoreId) {
      setCustomersCsvImportStatus({
        tone: 'error',
        message: 'Select a store before importing customers.',
      })
      return
    }

    try {
      setIsCustomersCsvImporting(true)
      setCustomersCsvImportStatus({ tone: 'info', message: 'Importing customers from CSV…' })
      const text = await selectedFile.text()
      const rows = csvToRows(text)
      if (!rows.length) {
        throw new Error('No rows detected in the CSV file.')
      }

      const [headerRow, ...dataRows] = rows
      const headerIndex = buildHeaderIndex(headerRow)
      if (headerIndex.name === undefined) {
        throw new Error('Missing required header: name')
      }

      const existingCustomersSnapshot = await getDocs(
        query(collection(db, 'customers'), where('storeId', '==', activeStoreId)),
      )
      const existingByEmail = new Map<string, string>()
      const existingByPhone = new Map<string, string>()

      const trackCustomerKeys = (id: string, values: { email?: string; phone?: string }) => {
        const emailKey = normalizeKey(values.email)
        const phoneKey = buildPhoneKey(values.phone ?? '')
        if (emailKey) {
          existingByEmail.set(emailKey, id)
        }
        if (phoneKey) {
          existingByPhone.set(phoneKey, id)
        }
      }

      existingCustomersSnapshot.forEach(docSnap => {
        const data = docSnap.data() as Record<string, unknown>
        trackCustomerKeys(docSnap.id, {
          email: normalizeText(data.email),
          phone: normalizeText(data.phone),
        })
      })

      const shouldSetDisplayName = headerIndex.display_name !== undefined
      const shouldSetPhone = headerIndex.phone !== undefined
      const shouldSetEmail = headerIndex.email !== undefined
      const shouldSetBirthdate = headerIndex.birthdate !== undefined
      const shouldSetNotes = headerIndex.notes !== undefined
      const shouldSetTags = headerIndex.tags !== undefined

      let importedCount = 0
      let skippedCount = 0
      let updatedCount = 0

      for (const row of dataRows) {
        if (!row.length || row.every(cell => !cell.trim())) {
          continue
        }
        const name = normalizeText(getRowValue(row, headerIndex, 'name'))
        if (!name) {
          skippedCount += 1
          continue
        }
        const displayName = normalizeText(getRowValue(row, headerIndex, 'display_name'))
        const phone = normalizeText(getRowValue(row, headerIndex, 'phone'))
        const email = normalizeText(getRowValue(row, headerIndex, 'email'))
        const birthdate = normalizeBirthdateInput(getRowValue(row, headerIndex, 'birthdate'))
        const notes = normalizeText(getRowValue(row, headerIndex, 'notes'))
        const tagsRaw = getRowValue(row, headerIndex, 'tags')
        const tags = tagsRaw
          ? tagsRaw
              .split(',')
              .map(tag => tag.trim())
              .filter(Boolean)
          : []

        const normalizedPhone = normalizePhoneNumber(phone)
        const emailKey = normalizeKey(email)
        const phoneKey = buildPhoneKey(normalizedPhone)
        const existingId =
          (emailKey && existingByEmail.get(emailKey)) ||
          (phoneKey && existingByPhone.get(phoneKey))

        const payload: Record<string, unknown> = {
          name: displayName || name,
          storeId: activeStoreId,
          updatedAt: serverTimestamp(),
        }
        const isNewCustomer = !existingId
        if (isNewCustomer) {
          payload.createdAt = serverTimestamp()
        }

        const setCustomerField = (shouldSet: boolean, key: string, value: unknown) => {
          if (isNewCustomer || shouldSet) {
            payload[key] = value
          }
        }

        setCustomerField(shouldSetDisplayName, 'displayName', displayName || null)
        setCustomerField(shouldSetPhone, 'phone', normalizedPhone || null)
        setCustomerField(shouldSetEmail, 'email', email || null)
        setCustomerField(shouldSetNotes, 'notes', notes || null)
        setCustomerField(shouldSetBirthdate, 'birthdate', birthdate || null)
        setCustomerField(shouldSetTags, 'tags', tags.length ? tags : [])

        if (existingId) {
          await updateDoc(doc(db, 'customers', existingId), payload)
          updatedCount += 1
          trackCustomerKeys(existingId, { email, phone: normalizedPhone })
        } else {
          const docRef = await addDoc(collection(db, 'customers'), payload)
          importedCount += 1
          trackCustomerKeys(docRef.id, { email, phone: normalizedPhone })
        }
      }

      if (!importedCount && !updatedCount) {
        throw new Error('No valid customer rows were found in this file.')
      }

      setCustomersCsvImportStatus({
        tone: 'success',
        message: `Imported ${importedCount + updatedCount} customers (${importedCount} new, ${updatedCount} updated)${
          skippedCount ? `, ${skippedCount} skipped.` : '.'
        }`,
      })
      clearSelectedFile()
    } catch (error) {
      console.error('Failed to import customers CSV', error)
      setCustomersCsvImportStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to import customers CSV. Please check the console for details.',
      })
    } finally {
      setIsCustomersCsvImporting(false)
    }
  }

  // NEW: Export items template → Excel (OneDrive)
  async function handleExportItemsToExcel() {
    try {
      setIsItemsExcelExporting(true)
      setItemsExcelExportStatus({ tone: 'info', message: 'Exporting items to Excel…' })

      // 1) Ensure Microsoft sign-in
      const account = await signInWithMicrosoft()
      if (!account) {
        setItemsExcelExportStatus({ tone: 'info', message: 'Microsoft sign-in canceled.' })
        // user cancelled or sign-in failed gracefully
        return
      }

      // 2) Get Graph token
      const token = await acquireGraphToken(['Files.ReadWrite.All', 'Sites.ReadWrite.All'])

      // 3) Convert CSV template to rows
      if (!itemTemplate || itemTemplate.trim().length === 0) {
        setItemsExcelExportStatus({ tone: 'info', message: 'No item data available to export.' })
        return
      }

      const rows = csvToRows(itemTemplate)
      const [headerRow, ...dataRows] = rows
      const rowsToExport = dataRows.length > 0 ? dataRows : []

      // 4) Push rows into sedifex-items.xlsx / Table1
      await addRowsToExcelTable(
        token,
        'sedifex-items.xlsx',
        'Table1',
        rowsToExport,
        headerRow ?? [],
      )

      setItemsExcelExportStatus({
        tone: 'success',
        message: 'Items exported to Excel in your OneDrive (sedifex-items.xlsx).',
      })
    } catch (error) {
      console.error('Failed to export items to Excel', error)
      setItemsExcelExportStatus({
        tone: 'error',
        message: 'Failed to export items to Excel. Please check the console for details.',
      })
    } finally {
      setIsItemsExcelExporting(false)
    }
  }

  // NEW: Export customers template → Excel (OneDrive)
  async function handleExportCustomersToExcel() {
    try {
      setIsCustomersExcelExporting(true)
      setCustomersExcelExportStatus({
        tone: 'info',
        message: 'Exporting customers to Excel…',
      })

      const account = await signInWithMicrosoft()
      if (!account) {
        setCustomersExcelExportStatus({ tone: 'info', message: 'Microsoft sign-in canceled.' })
        return
      }

      const token = await acquireGraphToken(['Files.ReadWrite.All', 'Sites.ReadWrite.All'])

      if (!customerTemplate || customerTemplate.trim().length === 0) {
        setCustomersExcelExportStatus({
          tone: 'info',
          message: 'No customer data available to export.',
        })
        return
      }

      const rows = csvToRows(customerTemplate)
      const [headerRow, ...dataRows] = rows
      const rowsToExport = dataRows.length > 0 ? dataRows : []

      await addRowsToExcelTable(
        token,
        'sedifex-customers.xlsx',
        'Table1',
        rowsToExport,
        headerRow ?? [],
      )

      setCustomersExcelExportStatus({
        tone: 'success',
        message: 'Customers exported to Excel in your OneDrive (sedifex-customers.xlsx).',
      })
    } catch (error) {
      console.error('Failed to export customers to Excel', error)
      setCustomersExcelExportStatus({
        tone: 'error',
        message: 'Failed to export customers to Excel. Please check the console for details.',
      })
    } finally {
      setIsCustomersExcelExporting(false)
    }
  }

  async function handleImportItemsFromExcel() {
    try {
      setIsItemsExcelImporting(true)
      setItemsExcelImportStatus({
        tone: 'info',
        message: 'Fetching items from Excel…',
      })

      const account = await signInWithMicrosoft()
      if (!account) {
        setItemsExcelImportStatus({ tone: 'info', message: 'Microsoft sign-in canceled.' })
        return
      }

      const token = await acquireGraphToken(['Files.ReadWrite.All', 'Sites.ReadWrite.All'])
      const data = await fetchExcelTableRows(token, 'sedifex-items.xlsx', 'Table1')

      if (!data || data.headers.length === 0) {
        setItemsExcelImportStatus({
          tone: 'info',
          message: 'No items table found in sedifex-items.xlsx. Please export first.',
        })
        return
      }

      const csv = buildCsvFromRows(data.headers, data.rows)
      if (!csv) {
        setItemsExcelImportStatus({
          tone: 'info',
          message: 'No items data found in sedifex-items.xlsx.',
        })
        return
      }

      downloadCsv('sedifex-items-import.csv', csv)
      setItemsExcelImportStatus({
        tone: 'success',
        message: 'Items downloaded from Excel. Upload the CSV to import.',
      })
    } catch (error) {
      console.error('Failed to import items from Excel', error)
      setItemsExcelImportStatus({
        tone: 'error',
        message: 'Failed to import items from Excel. Please check the console for details.',
      })
    } finally {
      setIsItemsExcelImporting(false)
    }
  }

  async function handleImportCustomersFromExcel() {
    try {
      setIsCustomersExcelImporting(true)
      setCustomersExcelImportStatus({
        tone: 'info',
        message: 'Fetching customers from Excel…',
      })

      const account = await signInWithMicrosoft()
      if (!account) {
        setCustomersExcelImportStatus({ tone: 'info', message: 'Microsoft sign-in canceled.' })
        return
      }

      const token = await acquireGraphToken(['Files.ReadWrite.All', 'Sites.ReadWrite.All'])
      const data = await fetchExcelTableRows(token, 'sedifex-customers.xlsx', 'Table1')

      if (!data || data.headers.length === 0) {
        setCustomersExcelImportStatus({
          tone: 'info',
          message: 'No customers table found in sedifex-customers.xlsx. Please export first.',
        })
        return
      }

      const csv = buildCsvFromRows(data.headers, data.rows)
      if (!csv) {
        setCustomersExcelImportStatus({
          tone: 'info',
          message: 'No customer data found in sedifex-customers.xlsx.',
        })
        return
      }

      downloadCsv('sedifex-customers-import.csv', csv)
      setCustomersExcelImportStatus({
        tone: 'success',
        message: 'Customers downloaded from Excel. Upload the CSV to import.',
      })
    } catch (error) {
      console.error('Failed to import customers from Excel', error)
      setCustomersExcelImportStatus({
        tone: 'error',
        message: 'Failed to import customers from Excel. Please check the console for details.',
      })
    } finally {
      setIsCustomersExcelImporting(false)
    }
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
          <div className="data-transfer__section">
            <h4 className="data-transfer__section-title">CSV file import</h4>
            <ol className="data-transfer__steps">
              <li>
                <span className="data-transfer__step-label">Step 1:</span>
                Download the items or customers template.
              </li>
              <li>
                <span className="data-transfer__step-label">Step 2:</span>
                Fill in the CSV and upload it below.
              </li>
              <li>
                <span className="data-transfer__step-label">Step 3:</span>
                Import items or customers.
              </li>
            </ol>
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
                onClick={() =>
                  downloadCsv('sedifex-customers-import-template.csv', customerTemplate)
                }
              >
                Download customers template
              </button>
            </div>
            <div className="data-transfer__header-summary">
              <div className="data-transfer__header-summary-title">
                <span>Required headers</span>
                <a className="data-transfer__header-toggle" href="#data-transfer-guide">
                  Show full headers
                </a>
              </div>
              <div className="data-transfer__header-summary-list">
                <span className="data-transfer__header-summary-label">Items:</span>
                {itemRequired.map(header => (
                  <span key={header.key} className="data-transfer__header-chip">
                    {header.key}
                  </span>
                ))}
                <span className="data-transfer__header-summary-label">Customers:</span>
                {customerRequired.map(header => (
                  <span key={header.key} className="data-transfer__header-chip">
                    {header.key}
                  </span>
                ))}
              </div>
            </div>
            <div className="data-transfer__upload">
              <input
                className="data-transfer__file-input"
                id="data-transfer-upload"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                ref={fileInputRef}
              />
              <label className="button button--outline" htmlFor="data-transfer-upload">
                Choose CSV file
              </label>
              <span className="data-transfer__file-name">
                {selectedFile ? selectedFile.name : 'No file selected'}
              </span>
            </div>
            {headerValidation && (
              <div className="data-transfer__validation">
                {headerValidation.error && (
                  <p className="data-transfer__validation-error">{headerValidation.error}</p>
                )}
                {!headerValidation.error && headerValidation.itemsMissing.length > 0 && (
                  <p className="data-transfer__validation-error">
                    Missing required item headers: {headerValidation.itemsMissing.join(', ')}.
                  </p>
                )}
                {!headerValidation.error && headerValidation.customersMissing.length > 0 && (
                  <p className="data-transfer__validation-error">
                    Missing required customer headers:{' '}
                    {headerValidation.customersMissing.join(', ')}.
                  </p>
                )}
                {!headerValidation.error && validationSummary && (
                  <p className="data-transfer__validation-success">{validationSummary}</p>
                )}
              </div>
            )}
            <div className="data-transfer__actions data-transfer__actions--stacked">
              <div className="data-transfer__action">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={handleImportItemsFromCsv}
                  disabled={!selectedFile || isItemsCsvImporting}
                >
                  {isItemsCsvImporting ? 'Importing items…' : 'Import items from CSV'}
                </button>
                {itemsCsvImportStatus && (
                  <p
                    className={`data-transfer__status data-transfer__status--${itemsCsvImportStatus.tone}`}
                  >
                    {itemsCsvImportStatus.message}
                  </p>
                )}
              </div>
              <div className="data-transfer__action">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={handleImportCustomersFromCsv}
                  disabled={!selectedFile || isCustomersCsvImporting}
                >
                  {isCustomersCsvImporting ? 'Importing customers…' : 'Import customers from CSV'}
                </button>
                {customersCsvImportStatus && (
                  <p
                    className={`data-transfer__status data-transfer__status--${customersCsvImportStatus.tone}`}
                  >
                    {customersCsvImportStatus.message}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="data-transfer__section">
            <h4 className="data-transfer__section-title">OneDrive Excel import</h4>
            <ol className="data-transfer__steps">
              <li>
                <span className="data-transfer__step-label">Step 1:</span>
                Pull the latest sedifex-items.xlsx or sedifex-customers.xlsx from OneDrive.
              </li>
              <li>
                <span className="data-transfer__step-label">Step 2:</span>
                Upload the downloaded CSV using the uploader above.
              </li>
              <li>
                <span className="data-transfer__step-label">Step 3:</span>
                Import the CSV with the buttons above.
              </li>
            </ol>
            <div className="data-transfer__actions data-transfer__actions--stacked">
              <div className="data-transfer__action">
                <button
                  type="button"
                  className="button button--outline"
                  onClick={handleImportItemsFromExcel}
                  disabled={isItemsExcelImporting}
                >
                  {isItemsExcelImporting
                    ? 'Importing items from Excel…'
                    : 'Import items from Excel (OneDrive)'}
                </button>
                {itemsExcelImportStatus && (
                  <p
                    className={`data-transfer__status data-transfer__status--${itemsExcelImportStatus.tone}`}
                  >
                    {itemsExcelImportStatus.message}
                  </p>
                )}
              </div>
              <div className="data-transfer__action">
                <button
                  type="button"
                  className="button button--outline"
                  onClick={handleImportCustomersFromExcel}
                  disabled={isCustomersExcelImporting}
                >
                  {isCustomersExcelImporting
                    ? 'Importing customers from Excel…'
                    : 'Import customers from Excel (OneDrive)'}
                </button>
                {customersExcelImportStatus && (
                  <p
                    className={`data-transfer__status data-transfer__status--${customersExcelImportStatus.tone}`}
                  >
                    {customersExcelImportStatus.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="card data-transfer__card">
          <h3>Export CSV</h3>
          <p className="data-transfer__muted">
            Export files keep the same headers, so you can re-import later without edits.
          </p>
          <div className="data-transfer__actions data-transfer__actions--stacked">
            {/* Existing CSV downloads */}
            <div className="data-transfer__action">
              <button
                type="button"
                className="button button--primary"
                onClick={handleDownloadItemsCsv}
                disabled={isItemsCsvExporting}
              >
                {isItemsCsvExporting ? 'Downloading items CSV…' : 'Download items CSV'}
              </button>
              {itemsCsvExportStatus && (
                <p
                  className={`data-transfer__status data-transfer__status--${itemsCsvExportStatus.tone}`}
                >
                  {itemsCsvExportStatus.message}
                </p>
              )}
            </div>
            <div className="data-transfer__action">
              <button
                type="button"
                className="button button--primary"
                onClick={handleDownloadCustomersCsv}
                disabled={isCustomersCsvExporting}
              >
                {isCustomersCsvExporting
                  ? 'Downloading customers CSV…'
                  : 'Download customers CSV'}
              </button>
              {customersCsvExportStatus && (
                <p
                  className={`data-transfer__status data-transfer__status--${customersCsvExportStatus.tone}`}
                >
                  {customersCsvExportStatus.message}
                </p>
              )}
            </div>

            {/* NEW: Excel export buttons */}
            <div className="data-transfer__action">
              <button
                type="button"
                className="button button--ghost"
                onClick={handleExportItemsToExcel}
                disabled={isItemsExcelExporting}
              >
                {isItemsExcelExporting
                  ? 'Exporting items to Excel…'
                  : 'Export items to Excel (OneDrive)'}
              </button>
              {itemsExcelExportStatus && (
                <p
                  className={`data-transfer__status data-transfer__status--${itemsExcelExportStatus.tone}`}
                >
                  {itemsExcelExportStatus.message}
                </p>
              )}
            </div>
            <div className="data-transfer__action">
              <button
                type="button"
                className="button button--ghost"
                onClick={handleExportCustomersToExcel}
                disabled={isCustomersExcelExporting}
              >
                {isCustomersExcelExporting
                  ? 'Exporting customers to Excel…'
                  : 'Export customers to Excel (OneDrive)'}
              </button>
              {customersExcelExportStatus && (
                <p
                  className={`data-transfer__status data-transfer__status--${customersExcelExportStatus.tone}`}
                >
                  {customersExcelExportStatus.message}
                </p>
              )}
            </div>
          </div>
          <p className="data-transfer__hint">
            Tip: Keep headers lowercase with underscores exactly as shown.
          </p>
        </section>
      </div>

      <div className="data-transfer__guide" id="data-transfer-guide">
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
