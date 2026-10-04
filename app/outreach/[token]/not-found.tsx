import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };

export default function OutreachNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <div
        className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4 text-sm text-[var(--ts-accent)]"
        style={radiusStyle}
      >
        This link isn&apos;t valid.
      </div>
      <footer className="mt-10 text-xs text-[var(--ts-ink-muted-on-paper)]">
        Payments and contracting powered by Taylslate.
      </footer>
    </div>
  );
}
