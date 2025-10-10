import * as functions from 'firebase-functions'
import { defaultDb as db } from './firestore'

export const confirmPayment = functions.https.onRequest(async (req, res) => {
  // CORS (basic)
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).send('')

  try {
    const reference = String(req.query.reference || '').trim()
    if (!reference) return res.status(400).json({ ok: false, error: 'Missing reference' })

    const snap = await db.collection('payments').doc(reference).get()
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Reference not found' })
    const data = snap.data() || {}

    // Expect webhook to set status:'paid'
    if (data.status !== 'paid') {
      return res.status(200).json({ ok: false, status: data.status || 'pending' })
    }

    // Mark the reference usable once (optional):
    await snap.ref.set({ ...data, confirmedAt: new Date() }, { merge: true })

    return res.status(200).json({
      ok: true,
      status: 'paid',
      email: data.email || null,
      planCode: data.planCode || null,
      planId: data.planId || null,
      amount: data.amount || null,
    })
  } catch (err: any) {
    functions.logger.error('confirmPayment failed', err)
    return res.status(500).json({ ok: false, error: err?.message || 'Internal error' })
  }
})
