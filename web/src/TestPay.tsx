import React from "react";
const PAYSTACK_PK = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY!;

function toKobo(ghs: number) { return Math.round(ghs * 100); }

export default function TestPay() {
  const pay = () => {
    // @ts-ignore
    const handler = window.PaystackPop.setup({
      key: PAYSTACK_PK,
      email: "testbuyer@example.com",
      amount: toKobo(12.5), // GHS 12.50 (Paystack expects minor units)
      currency: "GHS",
      ref: `SFX_${Date.now()}`,
      callback: (resp: any) => {
        alert("Reference: " + resp.reference);
        // normally you'd call commitSale(sale, { providerRef: resp.reference, ... })
      },
      onClose: () => alert("Checkout closed"),
    });
    handler.openIframe();
  };
  return <button onClick={pay}>Pay GHS 12.50 (Test)</button>;
}
