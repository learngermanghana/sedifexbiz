import type { ComponentPropsWithoutRef } from 'react'

export type ScanResultSource = 'manual' | 'camera' | 'scanner'

export type ScanResult = {
  code: string
  source: ScanResultSource
}

export type BarcodeScannerProps = {
  className?: string
  enableCameraFallback?: boolean
  manualEntryLabel?: string
  onScan?: (result: ScanResult) => void
  onError?: (message: string) => void
} & ComponentPropsWithoutRef<'div'>

export default function BarcodeScanner(_props: BarcodeScannerProps) {
  return null
}
