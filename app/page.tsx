import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--brand-navy)] text-white overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[var(--brand-blue)] opacity-[0.07] blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-[var(--brand-teal)] opacity-[0.05] blur-[100px]" />
      </div>

      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-teal)] flex items-center justify-center">
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <span className="text-xl font-bold tracking-tight">taylslate</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/login" className="text-sm text-white/70 hover:text-white transition-colors">
            Log in
          </Link>
          <Link href="/signup" className="text-sm bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] px-5 py-2.5 rounded-lg font-medium transition-colors">
            Get started free
          </Link>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-8 pt-24 pb-32">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] mb-8">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-teal)] animate-pulse" />
            <span className="text-xs text-white/60 font-medium tracking-wide uppercase">
              AI-Powered Media Planning
            </span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight mb-6">
            Plan podcast campaigns in{" "}
            <span className="bg-gradient-to-r from-[var(--brand-blue-light)] to-[var(--brand-teal-light)] bg-clip-text text-transparent">
              minutes
            </span>
            , not weeks
          </h1>

          <p className="text-lg sm:text-xl text-white/50 leading-relaxed max-w-xl mb-10">
            Taylslate finds the right shows for your brand, optimizes your budget, and drafts your outreach — so you can launch campaigns faster than any agency.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <Link href="/campaigns" className="inline-flex items-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white px-7 py-3.5 rounded-xl font-semibold text-base transition-all hover:translate-y-[-1px] hover:shadow-lg hover:shadow-blue-500/20">
              Enter Dashboard
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="ml-1">
                <path d="M3 8h10m0 0L9 4m4 4L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <span className="text-sm text-white/30">Development preview</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8 max-w-2xl mt-24 pt-12 border-t border-white/[0.06]">
          <div>
            <div className="text-3xl font-bold text-white mb-1">50K+</div>
            <div className="text-sm text-white/40">Podcasts indexed</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-white mb-1">2 min</div>
            <div className="text-sm text-white/40">Average plan time</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-white mb-1">10x</div>
            <div className="text-sm text-white/40">Faster than manual</div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-5 mt-24">
          <div className="group p-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all">
            <div className="w-10 h-10 rounded-xl bg-[var(--brand-blue)]/10 flex items-center justify-center mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <h3 className="font-semibold mb-2">Smart Discovery</h3>
            <p className="text-sm text-white/40 leading-relaxed">AI scores thousands of shows against your brand, audience, and budget to find the perfect fit.</p>
          </div>
          <div className="group p-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all">
            <div className="w-10 h-10 rounded-xl bg-[var(--brand-teal)]/10 flex items-center justify-center mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-teal-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <h3 className="font-semibold mb-2">Budget Optimizer</h3>
            <p className="text-sm text-white/40 leading-relaxed">Automatically allocate spend across shows using real CPM data and proven media buying rules.</p>
          </div>
          <div className="group p-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all">
            <div className="w-10 h-10 rounded-xl bg-[var(--brand-orange)]/10 flex items-center justify-center mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-orange)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2Z" /><path d="m22 6-10 7L2 6" />
              </svg>
            </div>
            <h3 className="font-semibold mb-2">Ready-to-Send Outreach</h3>
            <p className="text-sm text-white/40 leading-relaxed">AI drafts personalized pitch emails and ad scripts for every show on your plan.</p>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] py-8 px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <span className="text-sm text-white/30">&copy; 2026 Taylslate. All rights reserved.</span>
          <div className="flex items-center gap-6">
            <Link href="#" className="text-sm text-white/30 hover:text-white/60">Terms</Link>
            <Link href="#" className="text-sm text-white/30 hover:text-white/60">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}