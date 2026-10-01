import Image from "next/image";
import Link from "next/link";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="onboarding-flow flex min-h-screen flex-col bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <header className="border-b border-[var(--ts-hairline-on-paper)] px-8 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/mark.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7"
            priority
          />
          <span className="text-[15px] font-semibold tracking-tight">taylslate</span>
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-8 py-12">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
