const assert = require('assert')
const {
  buildEventContractPdf,
  hashPublicContractToken,
  normalizeSignatureText,
  signatureMatchesSigner,
} = require('../lib/eventContractSigningCore')

function run() {
  const firstHash = hashPublicContractToken('secure-token-example')
  assert.strictEqual(firstHash, hashPublicContractToken('secure-token-example'))
  assert.notStrictEqual(firstHash, hashPublicContractToken('different-token'))
  assert.match(firstHash, /^[a-f0-9]{64}$/)

  assert.strictEqual(normalizeSignatureText('  Sandra   Asanté  '), 'sandra asante')
  assert.strictEqual(signatureMatchesSigner('Sandra Asante', 'Sandra Asante'), true)
  assert.strictEqual(signatureMatchesSigner('Sandra Asanté', 'SANDRA ASANTE'), true)
  assert.strictEqual(signatureMatchesSigner('Sandra Asante', 'Caterine'), false)
  assert.strictEqual(signatureMatchesSigner('', ''), false)

  const pdf = buildEventContractPdf({
    storeName: 'Elite Core Events',
    storeEmail: 'events@example.com',
    storePhone: '0200000000',
    eventTitle: 'Sandra & Kojo Wedding',
    eventCode: 'ECE-2026-12345',
    eventDate: '2026-12-12',
    eventTime: '14:00',
    venue: 'Accra',
    clientName: 'Sandra Asante',
    clientEmail: 'sandra@example.com',
    revision: 2,
    serviceAgreement: 'Plan and coordinate the event.',
    scopeOfWork: 'Venue coordination, decor management and vendor supervision.',
    paymentTerms: '50% deposit, balance due seven days before the event.',
    cancellationPolicy: 'Deposits are handled according to the agreed cancellation terms.',
    signerName: 'Sandra Asante',
    signerEmail: 'sandra@example.com',
    signatureText: 'Sandra Asante',
    signedAt: '2026-08-27T12:00:00.000Z',
  })

  assert.ok(Buffer.isBuffer(pdf))
  assert.strictEqual(pdf.subarray(0, 8).toString('utf8'), '%PDF-1.4')
  assert.ok(pdf.length > 500)
  assert.ok(pdf.toString('latin1').includes('EVENT SERVICE AGREEMENT'))
  assert.ok(pdf.toString('latin1').includes('Typed signature: Sandra Asante'))

  const longPdf = buildEventContractPdf({
    storeName: 'Elite Core Events',
    eventTitle: 'Large Event',
    clientName: 'Client',
    clientEmail: 'client@example.com',
    revision: 1,
    serviceAgreement: Array.from({ length: 120 }, (_, index) => `Agreement item ${index + 1} with additional contract detail.`).join(' '),
    scopeOfWork: 'Full event planning.',
    paymentTerms: 'Payment terms.',
    cancellationPolicy: 'Cancellation terms.',
  })
  assert.ok(longPdf.toString('latin1').includes('/Count 2') || longPdf.toString('latin1').includes('/Count 3'))

  console.log('event contract signing tests passed')
}

run()
