"use client";

import { useState, useEffect } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const panelClass = "mb-6 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

function CardIcon({ brand }: { brand: string }) {
  const label = brand.charAt(0).toUpperCase() + brand.slice(1);
  return (
    <span
      className="inline-block bg-[var(--ts-band-brands)] px-2 py-0.5 text-xs font-medium text-[var(--ts-ink-on-paper)]"
      style={radiusStyle}
    >
      {label}
    </span>
  );
}

function AddCardForm({ clientSecret, onSuccess }: { clientSecret: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSaving(true);
    setError(null);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    const { error: confirmError } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card: cardElement },
    });

    if (confirmError) {
      setError(confirmError.message || "Failed to save card");
      setSaving(false);
    } else {
      onSuccess();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <div className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-3" style={radiusStyle}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "14px",
                // Stripe paints this field in a cross-origin iframe, so it
                // cannot read --ts-* variables. Matches --ts-ink-on-paper
                // and --ts-ink-muted-on-paper.
                color: "#1c1915",
                "::placeholder": { color: "#5c564c" },
              },
            },
          }}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!stripe || saving}
          className={inkBtnClass}
          style={radiusStyle}
        >
          {saving ? "Saving..." : "Save Card"}
        </button>
      </div>
      {error && <p className={`text-sm ${accentText}`}>{error}</p>}
    </form>
  );
}

export default function CardForm() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeInstance, setStripeInstance] = useState<Promise<Stripe | null> | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPaymentMethods();
  }, []);

  async function fetchPaymentMethods() {
    try {
      const res = await fetch("/api/stripe/payment-method/list");
      if (!res.ok) throw new Error("Failed to load payment methods");
      const data = await res.json();
      setPaymentMethods(data.paymentMethods || []);
    } catch {
      setPaymentMethods([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddCard() {
    setError(null);
    try {
      // Fetch the publishable key from the server at runtime
      // (NEXT_PUBLIC_* vars can be empty if not set at build time)
      if (!stripeInstance) {
        const configRes = await fetch("/api/stripe/config");
        if (!configRes.ok) throw new Error("Stripe is not configured");
        const { publishableKey } = await configRes.json();
        setStripeInstance(loadStripe(publishableKey));
      }

      const res = await fetch("/api/stripe/payment-method/setup-intent", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create setup intent");
      }
      const { clientSecret: secret } = await res.json();
      setClientSecret(secret);
      setShowAddForm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/stripe/payment-method/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove payment method");
      setPaymentMethods((prev) => prev.filter((pm) => pm.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRemovingId(null);
    }
  }

  function handleAddSuccess() {
    setShowAddForm(false);
    setClientSecret(null);
    fetchPaymentMethods();
  }

  if (loading) {
    return (
      <div className={panelClass} style={radiusStyle}>
        <h2 className={`mb-4 font-semibold ${inkText}`}>Payment Methods</h2>
        <p className={`text-sm ${mutedText}`}>Loading payment methods...</p>
      </div>
    );
  }

  return (
    <div className={panelClass} style={radiusStyle}>
      <h2 className={`mb-4 font-semibold ${inkText}`}>Payment Methods</h2>

      {paymentMethods.length > 0 ? (
        <div className="mb-4 space-y-3">
          {paymentMethods.map((pm) => (
            <div
              key={pm.id}
              className="flex items-center justify-between border border-[var(--ts-hairline-on-paper)] p-3"
              style={radiusStyle}
            >
              <div className="flex items-center gap-3">
                <CardIcon brand={pm.brand} />
                <span className={`text-sm ${inkText}`}>
                  ****{pm.last4}
                </span>
                <span className={`text-sm ${mutedText}`}>
                  {String(pm.exp_month).padStart(2, "0")}/{pm.exp_year}
                </span>
              </div>
              <button
                onClick={() => handleRemove(pm.id)}
                disabled={removingId === pm.id}
                className={`text-sm ${mutedText} hover:text-[var(--ts-accent)] disabled:opacity-50`}
              >
                {removingId === pm.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className={`mb-4 text-sm ${mutedText}`}>No payment methods on file.</p>
      )}

      {showAddForm && clientSecret && stripeInstance ? (
        <Elements stripe={stripeInstance} options={{ clientSecret }}>
          <AddCardForm clientSecret={clientSecret} onSuccess={handleAddSuccess} />
        </Elements>
      ) : (
        <button
          onClick={handleAddCard}
          className={inkBtnClass}
          style={radiusStyle}
        >
          Add Payment Method
        </button>
      )}

      {error && <p className={`mt-3 text-sm ${accentText}`}>{error}</p>}
    </div>
  );
}
