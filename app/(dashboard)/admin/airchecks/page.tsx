import Link from "next/link";
import { loadAircheckQueue } from "@/lib/airchecks/store";
import type { AircheckMatchResult, AircheckQueueRow } from "@/lib/airchecks/types";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";

const MATCH_LABEL: Record<AircheckMatchResult, string> = {
  matched: "Matched",
  not_matched: "Not matched",
  skipped: "Skipped",
};

function matchLabel(value: AircheckMatchResult | null): string {
  if (!value) return "Not judged";
  return MATCH_LABEL[value];
}

function confidenceLabel(value: number | null): string {
  if (value == null) return "None";
  return `${Math.round(value * 100)}%`;
}

function matchedLabel(iso: string | null): string {
  if (!iso) return "None";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "None";
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fact(value: string | null): string {
  return value?.trim() ? value : "None";
}

function QueueTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: AircheckQueueRow[];
  empty: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--ts-ink-on-paper)]">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-muted-on-paper)]">
              <th scope="col" className="py-2 pr-3 font-medium">Show</th>
              <th scope="col" className="py-2 pr-3 font-medium">Advertiser</th>
              <th scope="col" className="py-2 pr-3 font-medium">Placement</th>
              <th scope="col" className="py-2 pr-3 font-medium">Match result</th>
              <th scope="col" className="py-2 pr-3 font-medium">Confidence</th>
              <th scope="col" className="py-2 pr-3 font-medium">Matched date</th>
              <th scope="col" className="py-2 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-3 text-[var(--ts-ink-muted-on-paper)]">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-on-paper)]"
                >
                  <td className="py-2 pr-3">{row.showName}</td>
                  <td className="py-2 pr-3">{fact(row.advertiserName)}</td>
                  <td className="py-2 pr-3">{fact(row.placement)}</td>
                  <td className="py-2 pr-3">{matchLabel(row.matchResult)}</td>
                  <td className="py-2 pr-3">{confidenceLabel(row.confidence)}</td>
                  <td className="py-2 pr-3">{matchedLabel(row.matchedAt)}</td>
                  <td className="py-2">
                    <Link
                      href={`/admin/airchecks/${row.ioLineItemId}`}
                      className="text-[var(--ts-accent-text)]"
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AircheckQueuePage() {
  const user = await getAuthenticatedUser();
  if (!user || !isInternalAdmin(user.email)) {
    return (
      <div className="max-w-2xl p-4 sm:p-8">
        <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
          This page is for Taylslate admins.
        </p>
      </div>
    );
  }

  const queue = await loadAircheckQueue();
  return (
    <div className="min-w-0 p-4 sm:p-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
        Aircheck
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
        Review queue
      </h1>
      <p className="mb-2 mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Lines waiting for a person. Open a line to confirm or reject it.
      </p>
      <QueueTable
        title="Ready for review"
        rows={queue.ready}
        empty="No lines are waiting for review."
      />
      <QueueTable
        title="Charge failed"
        rows={queue.chargeFailed}
        empty="No charge failures are waiting."
      />
    </div>
  );
}
