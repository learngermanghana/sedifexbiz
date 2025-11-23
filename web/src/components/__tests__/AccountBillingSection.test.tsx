import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountBillingSection } from '../AccountBillingSection'

const mockStartPaystackCheckout = vi.fn()

vi.mock('../../lib/paystackClient', () => ({
  startPaystackCheckout: (...args: Parameters<typeof mockStartPaystackCheckout>) =>
    mockStartPaystackCheckout(...args),
}))

describe('AccountBillingSection', () => {
  beforeEach(() => {
    mockStartPaystackCheckout.mockReset()
  })

  it('shows a message when the user is not the owner', () => {
    render(<AccountBillingSection storeId="store-123" ownerEmail="owner@example.com" isOwner={false} />)

    expect(screen.getByText(/only the workspace owner/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay with paystack/i })).not.toBeInTheDocument()
  })

  it('shows an error if the store id is missing', async () => {
    const user = userEvent.setup()
    render(<AccountBillingSection storeId={null} ownerEmail="owner@example.com" isOwner />)

    await user.click(screen.getByRole('button', { name: /pay with paystack/i }))

    expect(await screen.findByText(/missing store id/i)).toBeInTheDocument()
    expect(mockStartPaystackCheckout).not.toHaveBeenCalled()
  })

  it('starts the Paystack checkout when everything is valid', async () => {
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {})

    mockStartPaystackCheckout.mockResolvedValue({
      ok: true,
      authorizationUrl: 'https://paystack.example/checkout',
      reference: 'ref-123',
      publicKey: 'pk_test',
    })

    const user = userEvent.setup()
    render(<AccountBillingSection storeId="store-123" ownerEmail="owner@example.com" isOwner />)

    await user.selectOptions(screen.getByRole('combobox'), 'starter-yearly')
    await user.click(screen.getByRole('button', { name: /pay with paystack/i }))

    await waitFor(() => {
      expect(mockStartPaystackCheckout).toHaveBeenCalledWith({
        email: 'owner@example.com',
        storeId: 'store-123',
        amount: 100,
        plan: 'starter-yearly',
        redirectUrl: expect.stringContaining('/billing/verify'),
        metadata: { source: 'account-contract-billing' },
      })
    })

    expect(assignSpy).toHaveBeenCalledWith('https://paystack.example/checkout')
    assignSpy.mockRestore()
  })

  it('surfaces backend errors when checkout fails', async () => {
    mockStartPaystackCheckout.mockResolvedValue({ ok: false, authorizationUrl: null, reference: null })

    const user = userEvent.setup()
    render(<AccountBillingSection storeId="store-123" ownerEmail="owner@example.com" isOwner />)

    await user.click(screen.getByRole('button', { name: /pay with paystack/i }))

    expect(await screen.findByText(/unable to start checkout/i)).toBeInTheDocument()
  })
})
