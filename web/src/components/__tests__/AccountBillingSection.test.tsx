import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountBillingSection } from '../AccountBillingSection'

const mockStartPaystackCheckout = vi.fn()
const originalLocation = window.location

function mockWindowAssign() {
  const assignSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign: assignSpy },
  })
  return assignSpy
}

vi.mock('../../lib/paystackClient', () => ({
  startPaystackCheckout: (...args: Parameters<typeof mockStartPaystackCheckout>) =>
    mockStartPaystackCheckout(...args),
}))

  describe('AccountBillingSection', () => {
    beforeEach(() => {
      mockStartPaystackCheckout.mockReset()
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    })

    afterAll(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
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
    const assignSpy = mockWindowAssign()

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
        amount: 1100,
        plan: 'starter-yearly',
        redirectUrl: expect.stringContaining('/billing/verify'),
        metadata: { source: 'account-contract-billing' },
      })
    })

    expect(assignSpy).toHaveBeenCalledWith('https://paystack.example/checkout')
  })

  it('surfaces backend errors when checkout fails', async () => {
    mockStartPaystackCheckout.mockResolvedValue({ ok: false, authorizationUrl: null, reference: null })

    const user = userEvent.setup()
    render(<AccountBillingSection storeId="store-123" ownerEmail="owner@example.com" isOwner />)

    await user.click(screen.getByRole('button', { name: /pay with paystack/i }))

    expect(await screen.findByText(/unable to start checkout/i)).toBeInTheDocument()
  })

  it('shows a paid contract summary instead of the checkout form', () => {
    render(
      <AccountBillingSection
        storeId="store-123"
        ownerEmail="owner@example.com"
        isOwner
        contractStatus="active"
        billingPlan="starter-yearly"
        contractEndDate="Dec 31, 2024, 10:00 AM"
      />,
    )

    expect(screen.getByText(/contract is active on the starter – yearly plan/i)).toBeInTheDocument()
    expect(screen.getByText(/Dec 31, 2024, 10:00 AM/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay with paystack/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upgrade to yearly/i })).not.toBeInTheDocument()
  })

  it('lets a monthly customer upgrade to yearly and shows the expiry date', async () => {
    const user = userEvent.setup()
    const assignSpy = mockWindowAssign()

    mockStartPaystackCheckout.mockResolvedValue({
      ok: true,
      authorizationUrl: 'https://paystack.example/checkout',
      reference: 'ref-456',
      publicKey: 'pk_test',
    })

    render(
      <AccountBillingSection
        storeId="store-123"
        ownerEmail="owner@example.com"
        isOwner
        contractStatus="active"
        billingPlan="starter-monthly"
        contractEndDate="Jan 31, 2025, 10:00 AM"
      />,
    )

    expect(screen.getByText(/contract is active on the starter – monthly plan/i)).toBeInTheDocument()
    expect(screen.getByText(/Jan 31, 2025, 10:00 AM/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /upgrade to yearly/i }))

    await waitFor(() => {
      expect(mockStartPaystackCheckout).toHaveBeenCalledWith({
        email: 'owner@example.com',
        storeId: 'store-123',
        amount: 1100,
        plan: 'starter-yearly',
        redirectUrl: expect.stringContaining('/billing/verify'),
        metadata: { source: 'account-contract-billing' },
      })
    })

    expect(assignSpy).toHaveBeenCalledWith('https://paystack.example/checkout')
  })
})
