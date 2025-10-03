import type { ComponentPropsWithoutRef } from 'react'

export type ScanResultSource = 'manual' | 'camera' | 'scanner'

export type ScanResult = {
  code: string
  source: ScanResultSource
}

type DivProps = Omit<ComponentPropsWithoutRef<'div'>, 'onError'>

export type BarcodeScannerProps = DivProps & {
  className?: string
  enableCameraFallback?: boolean
  manualEntryLabel?: string
  onScan?: (result: ScanResult) => void
  onError?: (message: string) => void
}

export default function BarcodeScanner(_props: BarcodeScannerProps) {
  return null
}
