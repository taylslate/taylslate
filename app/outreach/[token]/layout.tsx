// Minimal public layout — no sidebar, no auth gate. The pitch is meant to be
// readable without an account.

export default function OutreachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pitch-page min-h-screen bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      {children}
    </div>
  );
}
