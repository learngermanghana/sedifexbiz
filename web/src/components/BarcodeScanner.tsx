import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library'

type ScanSource = 'keyboard' | 'manual' | 'camera'

export type ScanResult = {
  code: string
  source: ScanSource
}

type BarcodeScannerProps = {
  onScan: (result: ScanResult) => void
  onError?: (message: string) => void
  minLength?: number
  debounceMs?: number
  enableCameraFallback?: boolean
  manualEntryLabel?: string
  className?: string
}

function isTextInput(element: EventTarget | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (element.isContentEditable) return true
  return false
}

export function useKeyboardScanner(
  onScan: (result: ScanResult) => void,
  onError?: (message: string) => void,
  minLength = 3,
  debounceMs = 30,
) {
  const bufferRef = useRef('')
  const timerRef = useRef<number | null>(null)

  const resetBuffer = useCallback(() => {
    bufferRef.current = ''
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (isTextInput(event.target)) return

      if (event.key === 'Enter') {
        const value = bufferRef.current.trim()
        resetBuffer()
        if (!value) return
        if (value.length < minLength) {
          onError?.('Scanned codes look too short. Try again or use manual entry.')
          return
        }
        onScan({ code: value, source: 'keyboard' })
        return
      }

      if (event.key === 'Escape') {
        resetBuffer()
        return
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
          bufferRef.current = ''
          timerRef.current = null
        }, debounceMs)
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
      resetBuffer()
    }
  }, [debounceMs, minLength, onError, onScan, resetBuffer])
}

export default function BarcodeScanner({
  onScan,
  onError,
  minLength = 3,
  debounceMs = 30,
  enableCameraFallback = false,
  manualEntryLabel = 'Manual barcode entry',
  className,
}: BarcodeScannerProps) {
  const [manualCode, setManualCode] = useState('')
  const [isCameraActive, setIsCameraActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null)

  useKeyboardScanner(onScan, onError, minLength, debounceMs)

  useEffect(() => {
    if (!enableCameraFallback || !isCameraActive || !videoRef.current) return

    let cancelled = false

    const reader = new BrowserMultiFormatReader()
    const hints = new Map<DecodeHintType, any>()
    hints.set(DecodeHintType.TRY_HARDER, true)
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE,
    ])
    reader.setHints(hints)

    ;(async () => {
      try {
        let deviceId: string | undefined
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const videoDevices = devices.filter(d => d.kind === 'videoinput')
          if (videoDevices.length > 0) {
            const backCamera = videoDevices.find(d => /back|rear|environment/i.test(d.label || '')) || videoDevices[0]
            deviceId = backCamera.deviceId
          }
        }

        const controls = await reader.decodeFromVideoDevice(deviceId, videoRef.current!, (result, error) => {
          if (cancelled) return
          if (result) {
            const text = result.getText()
            if (text) onScan({ code: text, source: 'camera' })
          }
          if (error && !(error instanceof NotFoundException)) {
            console.error('[BarcodeScanner] Camera decode error', error)
          }
        })

        if (cancelled) {
          controls.stop()
          return
        }
        scannerControlsRef.current = controls
      } catch (error) {
        console.error('[BarcodeScanner] Unable to start camera', error)
        if (!cancelled) {
          onError?.('Unable to access the camera. Enter the code manually instead.')
          setIsCameraActive(false)
        }
      }
    })()

    return () => {
      cancelled = true
      scannerControlsRef.current?.stop()
      scannerControlsRef.current = null
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [enableCameraFallback, isCameraActive, onError, onScan])

  const handleManualSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const normalized = manualCode.trim()
      if (!normalized) {
        onError?.('Enter a barcode value before submitting.')
        return
      }
      setManualCode('')
      onScan({ code: normalized, source: 'manual' })
    },
    [manualCode, onError, onScan],
  )

  return (
    <div className={className}>
      {enableCameraFallback && (
        <div className="barcode-scanner__camera">
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setIsCameraActive(active => !active)}
          >
            {isCameraActive ? 'Stop camera preview' : 'Use camera to scan'}
          </button>
          {isCameraActive && (
            <div className="barcode-scanner__camera-preview">
              <video ref={videoRef} playsInline muted autoPlay className="barcode-scanner__video" />
              <p className="field__hint">
                Align the barcode within the frame. If detection fails, type the code below.
              </p>
            </div>
          )}
        </div>
      )}

      <form className="barcode-scanner__manual" onSubmit={handleManualSubmit}>
        <label className="field__label" htmlFor="barcode-manual-input">
          {manualEntryLabel}
        </label>
        <div className="barcode-scanner__manual-row">
          <input
            id="barcode-manual-input"
            placeholder="Type or paste a barcode"
            value={manualCode}
            onChange={event => setManualCode(event.target.value)}
          />
          <button type="submit" className="button button--secondary">
            Add
          </button>
        </div>
        <p className="field__hint">Scanned codes automatically fill here if hardware is unavailable.</p>
      </form>
    </div>
  )
}
