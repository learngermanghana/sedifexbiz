import type { VercelRequest, VercelResponse } from "@vercel/node";
// ⬇️ add ".js"
import { db } from "./_firebase-admin.js";


export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const { reference, saleId } = req.body || {};
  if (!reference || !saleId) return res.status(400).json({ ok: false, error: "reference and saleId required" });

  const secret = process.env.PAYSTACK_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: "PAYSTACK_SECRET not configured" });

  const r = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = await r.json();
  if (!json?.status) return res.status(200).json({ ok: false, status: "failed" });

  const success = json.data?.status === "success";
  await db().doc(`sales/${saleId}`).set({
    payment: {
      provider: "paystack",
      providerRef: reference,
      status: success ? "captured" : "failed",
      amountPaid: (json.data?.amount ?? 0) / 100,
      gatewayRaw: json.data
    }
  }, { merge: true });

  return res.status(200).json({ ok: true, status: success ? "captured" : "failed" });
}
