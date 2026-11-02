import Link from "next/link";
import type { ReactNode } from "react";
import { tokens } from "@/lib/brand/tokens";
import type { OpsDashboardData } from "@/lib/admin/ops-dashboard";
import {
  ACCOUNT_ROLES,
  CAMPAIGN_STATUSES,
  DEAL_STATUSES,
  filtersToEntries,
  filtersToHref,
  type OpsFilters,
} from "@/lib/admin/ops-filters";

const radius = { borderRadius: tokens.radius };
const card = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3";
const muted = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const kicker = "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";
const field =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const button =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)]";

const ROLE_LABELS: Record<string, string> = {
  brand: "Brands",
  show: "Shows",
  agency: "Agencies",
  agent: "Sales agents",
};

const ROLE_ONE: Record<string, string> = {
  brand: "Brand",
  show: "Show",
  agency: "Agency",
  agent: "Sales agent",
};

function labelize(value: string): string {
  if (ROLE_LABELS[value]) return ROLE_LABELS[value];
  const words = value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ") || "Unknown";
}

export function formatOpsDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatUsd(amount: number | null): string {
  if (amount == null || Number.isNaN(amount)) return "Not set";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function shortId(id: string): string {
  if (id.length <= 8) return id || "No id";
  return id.slice(0, 8);
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center bg-[var(--ts-band-shows)] px-2 py-0.5 text-xs font-medium text-[var(--ts-ink-on-paper)]"
      style={radius}
    >
      {children}
    </span>
  );
}

function HiddenFilters({ filters, omit }: { filters: OpsFilters; omit: (keyof OpsFilters)[] }) {
  return filtersToEntries(filters)
    .filter(([key]) => !omit.includes(key))
    .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />);
}

function ClearLink({ filters, omit, label }: { filters: OpsFilters; omit: (keyof OpsFilters)[]; label: string }) {
  return (
    <Link href={filtersToHref(filters, omit)} className={`${button} ml-2`} style={radius}>
      {label}
    </Link>
  );
}

function MatchLine({ matched, shown }: { matched: number | null; shown: number }) {
  if (matched == null) return null;
  return (
    <p className={muted}>
      {matched} match this filter.
      {matched > shown ? ` Showing the latest ${shown}.` : ""}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={card} style={radius}>
      <p className={kicker}>{label}</p>
      <p className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}

function Section({
  id,
  kickerText,
  title,
  lede,
  children,
}: {
  id: string;
  kickerText: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-10" aria-labelledby={`${id}-title`}>
      <p className={kicker}>{kickerText}</p>
      <h2
        id={`${id}-title`}
        className="mt-2 font-[family-name:var(--font-app-display)] text-xl font-semibold tracking-tight"
      >
        {title}
      </h2>
      {lede ? <p className={`mt-2 max-w-3xl ${muted}`}>{lede}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className={`mb-3 ${muted}`}>{children}</p>;
}

export function OpsView({ data, filters }: { data: OpsDashboardData; filters: OpsFilters }) {
  const fee = data.fees.summary;
  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <p className={kicker}>Admin</p>
        <h1 className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight">
          Operations
        </h1>
        <p className={`mt-2 max-w-3xl ${muted}`}>
          Read only. This page does not change accounts, campaigns, deals, or payments. It is not in the sidebar.
          Open it at /admin.
        </p>
        <p
          role="note"
          className="mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] px-4 py-2 text-sm text-[var(--ts-ink-on-paper)]"
          style={radius}
        >
          Founder view. Counts are live reads. Platform fees come from payment rows already stored here, not from a
          Stripe call.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Other admin tools">
          <Link href="/admin/brands" className={button} style={radius}>
            Managed brands
          </Link>
          <Link href="/admin/roster-requests" className={button} style={radius}>
            Roster requests
          </Link>
        </nav>
        <p className={`mt-4 ${muted}`}>Read at {formatOpsDate(data.generatedAt)}.</p>

        <Section
          id="accounts"
          kickerText="Signups"
          title="Accounts"
          lede="Brands, shows, and agencies are account roles. Sales agents are included so a rep signup is not hidden. These are people, not catalog shows."
        >
          {data.accounts.error ? <Note>{data.accounts.error}</Note> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.accounts.counts.map((item) => (
              <Stat key={item.key} label={labelize(item.key)} value={String(item.count)} />
            ))}
            <Stat
              label="Signups, 24 hours"
              value={data.accounts.signups24h == null ? "Unavailable" : String(data.accounts.signups24h)}
            />
            <Stat
              label="Signups, 7 days"
              value={data.accounts.signups7d == null ? "Unavailable" : String(data.accounts.signups7d)}
            />
          </div>
          <form method="get" action="/admin" className="mt-4 flex flex-wrap items-end gap-3" role="search" aria-label="Accounts">
            <HiddenFilters filters={filters} omit={["role", "userQ"]} />
            <div>
              <label htmlFor="ops-role" className="mb-1.5 block text-sm font-medium">
                Role
              </label>
              <select id="ops-role" name="role" defaultValue={filters.role} className={field} style={radius}>
                <option value="all">All roles</option>
                {ACCOUNT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {labelize(role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <label htmlFor="ops-user-q" className="mb-1.5 block text-sm font-medium">
                Search name, email, or company
              </label>
              <input
                id="ops-user-q"
                name="userQ"
                type="search"
                defaultValue={filters.userQ}
                autoComplete="off"
                className={`${field} w-full`}
                style={radius}
              />
            </div>
            <button type="submit" className={button} style={radius}>
              Search accounts
            </button>
            <ClearLink filters={filters} omit={["role", "userQ"]} label="Clear" />
          </form>
          {data.accounts.listError ? <Note>{data.accounts.listError}</Note> : null}
          <div className="mt-3">
            <MatchLine matched={data.accounts.matched} shown={data.accounts.rows.length} />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Accounts</caption>
              <thead>
                <tr className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-muted-on-paper)]">
                  <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Email</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Company</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Role</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Plan</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Signed up</th>
                  <th scope="col" className="py-2 font-medium">Managed</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-3 text-[var(--ts-ink-muted-on-paper)]">
                      No accounts match this filter.
                    </td>
                  </tr>
                ) : (
                  data.accounts.rows.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--ts-hairline-on-paper)]">
                      <td className="py-2 pr-3">{row.name}</td>
                      <td className="py-2 pr-3">{row.email || "No email"}</td>
                      <td className="py-2 pr-3">{row.company || "No company"}</td>
                      <td className="py-2 pr-3">{ROLE_ONE[row.role] ?? labelize(row.role)}</td>
                      <td className="py-2 pr-3">{row.plan ? labelize(row.plan) : "No plan"}</td>
                      <td className="py-2 pr-3">{formatOpsDate(row.createdAt)}</td>
                      <td className="py-2">{row.managed ? <Pill>Managed</Pill> : "No"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          id="campaigns"
          kickerText="Campaigns"
          title="Campaigns"
          lede="The count of active campaigns ignores the filter. The list opens on active."
        >
          {data.campaigns.error ? <Note>{data.campaigns.error}</Note> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Active"
              value={data.campaigns.active == null ? "Unavailable" : String(data.campaigns.active)}
            />
            {data.campaigns.counts
              .filter((item) => item.key !== "active")
              .map((item) => (
                <Stat key={item.key} label={labelize(item.key)} value={String(item.count)} />
              ))}
          </div>
          <form method="get" action="/admin" className="mt-4 flex flex-wrap items-end gap-3" role="search" aria-label="Campaigns">
            <HiddenFilters filters={filters} omit={["campaignStatus", "campaignQ"]} />
            <div>
              <label htmlFor="ops-campaign-status" className="mb-1.5 block text-sm font-medium">
                Status
              </label>
              <select
                id="ops-campaign-status"
                name="campaignStatus"
                defaultValue={filters.campaignStatus}
                className={field}
                style={radius}
              >
                <option value="active">Active</option>
                <option value="all">All statuses</option>
                {CAMPAIGN_STATUSES.filter((status) => status !== "active").map((status) => (
                  <option key={status} value={status}>
                    {labelize(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <label htmlFor="ops-campaign-q" className="mb-1.5 block text-sm font-medium">
                Search campaign or account
              </label>
              <input
                id="ops-campaign-q"
                name="campaignQ"
                type="search"
                defaultValue={filters.campaignQ}
                autoComplete="off"
                className={`${field} w-full`}
                style={radius}
              />
            </div>
            <button type="submit" className={button} style={radius}>
              Search campaigns
            </button>
            <ClearLink filters={filters} omit={["campaignStatus", "campaignQ"]} label="Clear" />
          </form>
          {data.campaigns.listError ? <Note>{data.campaigns.listError}</Note> : null}
          {data.campaigns.detailNote ? <Note>{data.campaigns.detailNote}</Note> : null}
          <div className="mt-3">
            <MatchLine matched={data.campaigns.matched} shown={data.campaigns.rows.length} />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Campaigns</caption>
              <thead>
                <tr className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-muted-on-paper)]">
                  <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Budget</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Account</th>
                  <th scope="col" className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-[var(--ts-ink-muted-on-paper)]">
                      No campaigns match this filter.
                    </td>
                  </tr>
                ) : (
                  data.campaigns.rows.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--ts-hairline-on-paper)]">
                      <td className="py-2 pr-3">{row.name}</td>
                      <td className="py-2 pr-3"><Pill>{labelize(row.status)}</Pill></td>
                      <td className="py-2 pr-3">{formatUsd(row.budget)}</td>
                      <td className="py-2 pr-3">{row.ownerEmail}</td>
                      <td className="py-2">{formatOpsDate(row.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          id="deals"
          kickerText="Deals"
          title="Deals"
          lede="Active means every status except completed and cancelled. The list opens on active."
        >
          {data.deals.error ? <Note>{data.deals.error}</Note> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active" value={data.deals.active == null ? "Unavailable" : String(data.deals.active)} />
            {data.deals.counts
              .filter((item) => item.count > 0)
              .map((item) => (
                <Stat key={item.key} label={labelize(item.key)} value={String(item.count)} />
              ))}
          </div>
          <form method="get" action="/admin" className="mt-4 flex flex-wrap items-end gap-3" role="search" aria-label="Deals">
            <HiddenFilters filters={filters} omit={["dealStatus", "dealQ"]} />
            <div>
              <label htmlFor="ops-deal-status" className="mb-1.5 block text-sm font-medium">
                Status
              </label>
              <select
                id="ops-deal-status"
                name="dealStatus"
                defaultValue={filters.dealStatus}
                className={field}
                style={radius}
              >
                <option value="active">Active</option>
                <option value="all">All statuses</option>
                {DEAL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {labelize(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <label htmlFor="ops-deal-q" className="mb-1.5 block text-sm font-medium">
                Search show or brand
              </label>
              <input
                id="ops-deal-q"
                name="dealQ"
                type="search"
                defaultValue={filters.dealQ}
                autoComplete="off"
                className={`${field} w-full`}
                style={radius}
              />
            </div>
            <button type="submit" className={button} style={radius}>
              Search deals
            </button>
            <ClearLink filters={filters} omit={["dealStatus", "dealQ"]} label="Clear" />
          </form>
          {data.deals.listError ? <Note>{data.deals.listError}</Note> : null}
          {data.deals.detailNote ? <Note>{data.deals.detailNote}</Note> : null}
          <div className="mt-3">
            <MatchLine matched={data.deals.matched} shown={data.deals.rows.length} />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Deals</caption>
              <thead>
                <tr className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-muted-on-paper)]">
                  <th scope="col" className="py-2 pr-3 font-medium">Show</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Brand</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Gross</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Created</th>
                  <th scope="col" className="py-2 font-medium">Id</th>
                </tr>
              </thead>
              <tbody>
                {data.deals.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-3 text-[var(--ts-ink-muted-on-paper)]">
                      No deals match this filter.
                    </td>
                  </tr>
                ) : (
                  data.deals.rows.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--ts-hairline-on-paper)]">
                      <td className="py-2 pr-3">{row.showName}</td>
                      <td className="py-2 pr-3">{row.brandEmail}</td>
                      <td className="py-2 pr-3"><Pill>{labelize(row.status)}</Pill></td>
                      <td className="py-2 pr-3">{formatUsd(row.totalGross)}</td>
                      <td className="py-2 pr-3">{formatOpsDate(row.createdAt)}</td>
                      <td className="py-2" title={row.id}>{shortId(row.id)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          id="fees"
          kickerText="Revenue"
          title="Platform fees"
          lede="Collected is the sum of application_fee_amount_cents on payments whose status is succeeded or completed. Pending and processing are not collected. Refunded and disputed stay out of the collected total."
        >
          {data.fees.error ? <Note>{data.fees.error}</Note> : null}
          {fee ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Collected" value={formatCents(fee.collectedCents)} />
                <Stat label="Collected, 30 days" value={formatCents(fee.last30DaysCents)} />
                <Stat label="Not yet collected" value={formatCents(fee.inFlightCents)} />
                <Stat label="Refunded fees" value={formatCents(fee.refundedCents)} />
              </div>
              <p className={`mt-3 ${muted}`}>
                {fee.collectedCount} collected payments
                {fee.missingFeeCount > 0
                  ? `, ${fee.missingFeeCount} with no fee snapshot`
                  : ""}
                . {fee.inFlightCount} still pending or processing. {fee.refundedCount} refunded.{" "}
                {fee.disputedCount} disputed ({formatCents(fee.disputedCents)}). {fee.failedCount} failed.
                {fee.truncated ? " Totals cover the first 5,000 payment rows." : ""}
              </p>
            </>
          ) : null}
        </Section>

        <Section
          id="youtube"
          kickerText="YouTube library"
          title="Library and pull queue"
          lede="Added counts use youtube_channels.created_at. Passed market filter is the stored boolean. Email counts appear only when a column name contains email."
        >
          {data.youtube.error ? <Note>{data.youtube.error}</Note> : null}
          {data.youtube.unavailableReason && !data.youtube.available ? (
            <Note>{data.youtube.unavailableReason}</Note>
          ) : null}
          {data.youtube.available ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Channels" value={data.youtube.total == null ? "Unavailable" : String(data.youtube.total)} />
              <Stat
                label="Passed market filter"
                value={
                  data.youtube.passedMarketFilter == null ? "Unavailable" : String(data.youtube.passedMarketFilter)
                }
              />
              <Stat
                label="Added, 24 hours"
                value={data.youtube.added24h == null ? "Unavailable" : String(data.youtube.added24h)}
              />
              <Stat
                label="Added, 7 days"
                value={data.youtube.added7d == null ? "Unavailable" : String(data.youtube.added7d)}
              />
            </div>
          ) : null}
          {data.youtube.emailNote ? <p className={`mt-3 ${muted}`}>{data.youtube.emailNote}</p> : null}
          {data.youtube.emails.length > 0 ? (
            <ul className={`mt-3 ${muted}`}>
              {data.youtube.emails.map((item) => (
                <li key={item.column}>
                  Emails found in {item.column}: {item.count}
                  {item.approximate ? " (non-null rows, empty values may be included)" : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <h3 className="mt-6 text-sm font-medium">Pull queue</h3>
          {data.youtube.queueUnavailableReason ? (
            <p className={`mt-2 ${muted}`}>{data.youtube.queueUnavailableReason}</p>
          ) : null}
          {data.youtube.queueAvailable ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {data.youtube.queueByStatus.map((item) => (
                <Stat key={item.key} label={labelize(item.key)} value={String(item.count)} />
              ))}
            </div>
          ) : null}
        </Section>

        <Section
          id="activity"
          kickerText="Errors and jobs"
          title="Recent errors and jobs"
          lede="Error events are domain events whose type contains fail, error, rolled_back, or unverified, plus payment.disputed. Payloads are not shown. YouTube job text is shortened and secrets are stripped."
        >
          {data.activity.error ? <Note>{data.activity.error}</Note> : null}
          <h3 className="text-sm font-medium">Error events</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Recent error events</caption>
              <thead>
                <tr className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-muted-on-paper)]">
                  <th scope="col" className="py-2 pr-3 font-medium">When</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Event</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Entity</th>
                  <th scope="col" className="py-2 font-medium">Id</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.events.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-[var(--ts-ink-muted-on-paper)]">
                      No recent error events.
                    </td>
                  </tr>
                ) : (
                  data.activity.events.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--ts-hairline-on-paper)]">
                      <td className="py-2 pr-3">{formatOpsDate(row.createdAt)}</td>
                      <td className="py-2 pr-3">{row.eventType}</td>
                      <td className="py-2 pr-3">{row.entityType}</td>
                      <td className="py-2" title={row.entityId}>{shortId(row.entityId)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <h3 className="mt-6 text-sm font-medium">Failed payments</h3>
          {data.activity.failedPayments.length === 0 ? (
            <p className={`mt-2 ${muted}`}>No failed payments in the latest rows.</p>
          ) : (
            <ul className={`mt-2 ${muted}`}>
              {data.activity.failedPayments.map((row) => (
                <li key={row.id}>
                  {formatOpsDate(row.createdAt)} <span title={row.id}>{shortId(row.id)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-6 text-sm font-medium">YouTube pull errors</h3>
          {data.activity.queueErrors.length === 0 ? (
            <p className={`mt-2 ${muted}`}>No YouTube pull errors.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {data.activity.queueErrors.map((row) => (
                <li key={row.id} className={card} style={radius}>
                  <p>
                    {formatOpsDate(row.createdAt)}. {row.kind || "job"}. {row.attempts} attempts.
                  </p>
                  <p className="mt-1">{row.value || "No value"}</p>
                  <p className={`mt-1 ${muted}`}>{row.lastError}</p>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-6 text-sm font-medium">Latest finished pull jobs</h3>
          {data.activity.recentDone.length === 0 ? (
            <p className={`mt-2 ${muted}`}>No finished pull jobs.</p>
          ) : (
            <ul className={`mt-2 ${muted}`}>
              {data.activity.recentDone.map((row) => (
                <li key={row.id}>
                  {formatOpsDate(row.createdAt)}. {row.kind || "job"}. {row.value || "No value"}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
