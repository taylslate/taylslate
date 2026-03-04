export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--brand-surface)] flex flex-col">
      <header className="px-8 py-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-teal)] flex items-center justify-center">
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-[var(--brand-text)]">
            taylslate
          </span>
        </div>
      </header>
      <main className="flex-1 flex items-start justify-center px-8 py-12">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
