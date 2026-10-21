import type { ReactNode } from "react";
import Link from "next/link";
import {
  NOT_ENOUGH_DATA,
  type DealLearningRow,
  type LearningReview,
  type LearningSection,
} from "@/lib/learning/review";

const card =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3";
const muted = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const radius = { borderRadius: "var(--ts-radius)" };

export function LearningReviewView({
  campaignId,
  campaignName,
  review,
}: {
  campaignId: string;
  campaignName: string;
  review: LearningReview;
}) {
  return (
    <div className="bg-[var(--ts-paper)] px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
        >
          Back to campaign
        </Link>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]">
          What we learned
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{campaignName}</h1>
        <p className={`mt-2 ${muted}`}>
          Scores and notes guide the next flight. They do not remove a show.
        </p>

        {!review.ready ? (
          <p className={`mt-8 ${muted}`} data-testid="learning-holding">
            This review opens after a flight completes.
          </p>
        ) : (
          <div className="mt-8 space-y-10">
            <Section title="Best audience ring" section={review.bestRing} testId="section-best-ring">
              {(items) =>
                items.length > 1 ? (
                  <p className="text-sm">
                    Tied. Each of these rings reported {items[0].reportedConversions} conversions.
                  </p>
                ) : null
              }
              {(ring) => (
                <li key={ring.ringId} className={card} style={radius}>
                  <p className="font-medium">{ring.label}</p>
                  <p className={muted}>
                    {ring.reportedConversions} reported conversions across {ring.showCount}{" "}
                    {ring.showCount === 1 ? "show" : "shows"}.
                  </p>
                </li>
              )}
            </Section>

            <Section title="Shows to renew" section={review.renew} testId="section-renew">
              {() => null}
              {(show) => (
                <li key={show.showId} className={card} style={radius}>
                  <p className="font-medium">{show.showName}</p>
                  <p className={muted}>
                    {show.reportedConversions == null
                      ? NOT_ENOUGH_DATA
                      : `${show.reportedConversions} reported conversions`}
                    {show.partial ? `. Other flights on this show: ${NOT_ENOUGH_DATA}.` : ""}
                  </p>
                  {show.reasoningLine && (
                    <p className="mt-1 text-sm">{show.reasoningLine}</p>
                  )}
                  {show.overrideNote && (
                    <p className="mt-1 text-sm">Note: {show.overrideNote}</p>
                  )}
                </li>
              )}
            </Section>

            <Section title="Host and read styles" section={review.styles} testId="section-styles">
              {() => null}
              {(style) => (
                <li key={`${style.dimension}-${style.key}`} className={card} style={radius}>
                  <p className="font-medium">{style.label}</p>
                  <p className={muted}>
                    {style.reportedConversions == null
                      ? NOT_ENOUGH_DATA
                      : `${style.reportedConversions} reported conversions`}
                    {style.partial ? `. Other flights in this style: ${NOT_ENOUGH_DATA}.` : ""}
                  </p>
                </li>
              )}
            </Section>

            <Section
              title="Scale-tier shows worth testing next"
              section={review.scaleNext}
              testId="section-scale"
            >
              {() => null}
              {(show) => (
                <li key={show.showId} className={card} style={radius}>
                  <p className="font-medium">{show.showName}</p>
                  <p className={muted}>
                    Score: {show.composite == null ? NOT_ENOUGH_DATA : show.composite}
                    {show.ringLabel ? ` · ${show.ringLabel}` : ""}
                  </p>
                  {show.sameRingAsWinner && (
                    <p className="mt-1 text-sm">Same ring as the one that converted.</p>
                  )}
                  {show.overrideNote && (
                    <p className="mt-1 text-sm">Note: {show.overrideNote}</p>
                  )}
                  {!show.overrideNote && show.composite != null && (
                    <p className={`mt-1 ${muted}`}>
                      Scored above the test budget. This campaign did not air it.
                    </p>
                  )}
                </li>
              )}
            </Section>

            <Section
              title="Wrong assumptions"
              section={review.wrongAssumptions}
              testId="section-wrong"
            >
              {() => null}
              {(ring) => (
                <li key={ring.ringId} className={card} style={radius}>
                  <p className="font-medium">{ring.label}</p>
                  <p className={muted}>
                    Kept as a ring, aired on {ring.showCount}{" "}
                    {ring.showCount === 1 ? "show" : "shows"}, and reported{" "}
                    {ring.reportedConversions} conversions.
                  </p>
                </li>
              )}
            </Section>

            <Section title="Overweight or avoid" section={review.weight} testId="section-weight">
              {() => null}
              {(call) => (
                <li key={`${call.direction}-${call.label}-${call.reason}`} className={card} style={radius}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ts-accent)]">
                    {call.direction === "overweight" ? "Overweight" : "Avoid"}
                    {call.source === "override" ? " · note" : ""}
                  </p>
                  <p className="mt-1 font-medium">{call.label}</p>
                  <p className={muted}>{call.reason}</p>
                </li>
              )}
            </Section>

            <section data-testid="section-deals">
              <h2 className="text-lg font-semibold">What each show did</h2>
              {review.deals.length === 0 ? (
                <p className={`mt-2 ${muted}`}>{NOT_ENOUGH_DATA}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {review.deals.map((deal) => (
                    <DealCard key={deal.dealId} deal={deal} />
                  ))}
                </ul>
              )}
            </section>

            <section data-testid="section-notes">
              <h2 className="text-lg font-semibold">Brand and rep notes</h2>
              {review.overrides.length === 0 ? (
                <p className={`mt-2 ${muted}`}>{NOT_ENOUGH_DATA}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {review.overrides.map((override) => (
                    <li key={override.id} className={card} style={radius}>
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ts-ink-muted-on-paper)]">
                        {override.authorRole === "rep" ? "Rep" : "Brand"} · {override.targetLabel}
                      </p>
                      <p className="mt-1 text-sm">{override.note}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section<T>({
  title,
  section,
  testId,
  children,
}: {
  title: string;
  section: LearningSection<T>;
  testId: string;
  children: [(items: T[]) => ReactNode, (item: T) => ReactNode];
}) {
  const [intro, renderItem] = children;
  return (
    <section data-testid={testId}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {section.missing ? (
        <p className={`mt-2 ${muted}`}>{section.missing}</p>
      ) : section.items.length === 0 ? (
        <p className={`mt-2 ${muted}`}>{section.measuredEmpty}</p>
      ) : (
        <>
          {intro(section.items)}
          <ul className="mt-3 space-y-3">{section.items.map((item) => renderItem(item))}</ul>
        </>
      )}
      {section.caveat && <p className={`mt-2 ${muted}`}>{section.caveat}</p>}
    </section>
  );
}

function DealCard({ deal }: { deal: DealLearningRow }) {
  return (
    <li className={card} style={radius} data-testid={`deal-${deal.dealId}`}>
      <p className="font-medium">{deal.showName}</p>
      <p className={muted}>
        {deal.inFlight ? "Still in flight." : "Aired."}
        {deal.ringLabel ? ` ${deal.ringLabel}.` : ""}
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Fact label="Promo code" value={deal.promoCode} />
        <Fact label="Code or URL on air" value={codeLabel(deal.codeOnAir)} />
        <Fact label="Aircheck" value={airLabel(deal.aircheckDecision)} />
        <Fact
          label="Reported conversions"
          value={
            deal.reportedConversions == null ? null : String(deal.reportedConversions)
          }
        />
        <Fact label="Read style" value={deal.readerLabel} />
        <Fact label="Placement" value={deal.placementLabel} />
        <div className="sm:col-span-2">
          <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--ts-ink-muted-on-paper)]">
            Tracking link
          </dt>
          <dd className="mt-0.5 text-sm break-all">
            {deal.trackingLink ? (
              <a href={deal.trackingLink} className="underline" rel="noreferrer">
                {deal.trackingLink}
              </a>
            ) : (
              NOT_ENOUGH_DATA
            )}
          </dd>
        </div>
        <Fact label="UTM clicks" value={null} />
      </dl>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--ts-ink-muted-on-paper)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value ?? NOT_ENOUGH_DATA}</dd>
    </div>
  );
}

function codeLabel(value: DealLearningRow["codeOnAir"]): string | null {
  if (value === "found") return "Found in the read";
  if (value === "missing") return "Not in the read";
  return null;
}

function airLabel(value: DealLearningRow["aircheckDecision"]): string | null {
  if (value === "confirmed") return "Confirmed";
  if (value === "rejected") return "Rejected";
  return null;
}
