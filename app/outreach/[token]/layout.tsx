// Minimal public layout — no sidebar, no auth gate. The pitch is meant to be
// readable without an account.

export default function OutreachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--brand-surface)]">
      {children}
    </div>
  );
}
