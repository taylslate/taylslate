"use client";

import { useState, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripePromise) {
    if (!STRIPE_PK) {
      console.error(
        "[CardForm] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set. " +
        "Check .env.local and Vercel environment variables."
      );
    }
    stripePromise = loadStripe(STRIPE_PK);
  }
  return stripePromise;
}

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
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]">
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
      <div className="p-3 rounded-lg border border-[var(--brand-border)] bg-white">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "14px",
                color: "#1a1a2e",
                "::placeholder": { color: "#9ca3af" },
              },
            },
          }}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!stripe || saving}
          className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Card"}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--brand-error)]">{error}</p>}
    </form>
  );
}

export default function CardForm() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
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
      const res = await fetch("/api/stripe/payment-method/setup-intent", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create setup intent");
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
      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="font-semibold text-[var(--brand-text)] mb-4">Payment Methods</h2>
        <p className="text-sm text-[var(--brand-text-muted)]">Loading payment methods...</p>
      </div>
    );
  }

  return (
    <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
      <h2 className="font-semibold text-[var(--brand-text)] mb-4">Payment Methods</h2>

      {paymentMethods.length > 0 ? (
        <div className="space-y-3 mb-4">
          {paymentMethods.map((pm) => (
            <div
              key={pm.id}
              className="flex items-center justify-between p-3 rounded-lg border border-[var(--brand-border)]"
            >
              <div className="flex items-center gap-3">
                <CardIcon brand={pm.brand} />
                <span className="text-sm text-[var(--brand-text)]">
                  ****{pm.last4}
                </span>
                <span className="text-sm text-[var(--brand-text-muted)]">
                  {String(pm.exp_month).padStart(2, "0")}/{pm.exp_year}
                </span>
              </div>
              <button
                onClick={() => handleRemove(pm.id)}
                disabled={removingId === pm.id}
                className="text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-error)] transition-colors disabled:opacity-50"
              >
                {removingId === pm.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--brand-text-muted)] mb-4">No payment methods on file.</p>
      )}

      {showAddForm && clientSecret ? (
        <Elements stripe={getStripe()} options={{ clientSecret }}>
          <AddCardForm clientSecret={clientSecret} onSuccess={handleAddSuccess} />
        </Elements>
      ) : (
        <button
          onClick={handleAddCard}
          className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
        >
          Add Payment Method
        </button>
      )}

      {error && <p className="text-sm text-[var(--brand-error)] mt-3">{error}</p>}
    </div>
  );
}
