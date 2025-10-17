import * as functions from 'firebase-functions'
import { defaultDb as db } from './firestore'

export const confirmPayment = functions.https.onRequest(async (req, res) => {
  // CORS (basic)
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }

  try {
    const reference = String(req.query.reference || '').trim()
    if (!reference) {
      res.status(400).json({ ok: false, error: 'Missing reference' })
      return
    }

    const snap = await db.collection('payments').doc(reference).get()
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: 'Reference not found' })
      return
    }
    const data = snap.data() || {}

    // Expect webhook to set status:'paid'
    if (data.status !== 'paid') {
      res.status(200).json({ ok: false, status: data.status || 'pending' })
      return
    }

    // Mark the reference usable once (optional):
    await snap.ref.set({ ...data, confirmedAt: new Date() }, { merge: true })

    res.status(200).json({
      ok: true,
      status: 'paid',
      email: data.email || null,
      planCode: data.planCode || null,
      planId: data.planId || null,
      amount: data.amount || null,
    })
    return
  } catch (err: any) {
    functions.logger.error('confirmPayment failed', err)
    res.status(500).json({ ok: false, error: err?.message || 'Internal error' })
  }
})
