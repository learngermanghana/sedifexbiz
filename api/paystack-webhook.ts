import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "./_firebase-admin";
import crypto from "crypto";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const secret = process.env.PAYSTACK_SECRET;
  if (!secret) return res.status(500).send("PAYSTACK_SECRET not configured");

  const signature = req.headers["x-paystack-signature"] as string | undefined;
  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  if (!signature || signature !== hash) return res.status(403).send("Invalid signature");

  const event = req.body?.event as string;
  const data = req.body?.data || {};

  if (event === "charge.success") {
    const reference = data.reference as string;
    if (reference) {
      const snap = await db()
        .collection("sales")
        .where("payment.providerRef", "==", reference)
        .limit(1)
        .get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        const prev = doc.data();
        await doc.ref.set({
          payment: {
            ...prev.payment,
            status: "captured",
            amountPaid: (data.amount ?? 0) / 100, // pesewas -> GHS
            gatewayRaw: data
          }
        }, { merge: true });
      }
    }
  }

  return res.status(200).send("ok");
}
