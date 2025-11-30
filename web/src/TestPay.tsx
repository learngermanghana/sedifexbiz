import React from 'react'
import { payWithPaystack } from './utils/paystack'

export default function TestPay() {
  const pay = async () => {
    const result = await payWithPaystack(12.5, {
      email: 'testbuyer@example.com',
      name: 'Test Buyer',
    })

    if (result.ok && result.reference) {
      alert('Reference: ' + result.reference)
    } else {
      alert(result.error ?? 'Checkout closed')
    }
  }
  return <button onClick={pay}>Pay GHS 12.50 (Test)</button>
}
