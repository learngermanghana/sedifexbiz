import React, { useState } from "react";
import { startCheckout } from "../lib/billing";

export default function TestPay() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await startCheckout("starter-monthly");
      // We expect startCheckout to redirect the browser on success, so no further action.
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unable to start checkout";
      setError(message);
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button onClick={handleCheckout} disabled={isLoading}>
        {isLoading ? "Redirecting…" : "Subscribe to Starter (Monthly)"}
      </button>
      {error && (
        <p role="alert" style={{ color: "var(--color-error, #c00)", marginTop: "0.5rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
