"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import {
  Flag,
  Handshake,
  LayoutDashboard,
  Receipt,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Card } from "@/components/arc/card/card";
import { DatePicker } from "@/components/arc/date-picker/date-picker";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getNavItemsForRole, type IconKey } from "@/lib/nav/items";
import { bodyFont, displayFont } from "./preview-fonts";
import styles from "./preview.module.css";
import {
  CAMPAIGN,
  FLIGHT_START,
  FLIGHTS,
  PIPELINE_COLUMNS,
  PRIMARY_ACTION,
  SHOWS,
  budgetRemaining,
  columnNet,
  dealsInColumn,
  flightsOnOrAfter,
  formatAirDate,
  formatMoney,
  isoFromDate,
  type PipelineDeal,
} from "./sample-data";

const NAV = getNavItemsForRole("brand");

const ICONS: Partial<Record<IconKey, LucideIcon>> = {
  dashboard: LayoutDashboard,
  campaigns: Flag,
  deals: Handshake,
  invoices: Receipt,
  settings: Settings,
};

function statusTone(status: string): "neutral" | "success" | "warning" {
  if (status === "Live" || status === "Delivering") return "success";
  if (status === "IO Sent" || status === "Brand signed") return "warning";
  return "neutral";
}

function CoverArt({ name, cover }: { name: string; cover: number }) {
  return <span className={styles.cover} data-cover={cover} role="img" aria-label={`${name} cover`} />;
}

function DealCard({ deal }: { deal: PipelineDeal }) {
  return (
    <Card
      title={deal.show}
      description={`${deal.episodes} episodes · ${deal.placement}`}
      media={<CoverArt name={deal.show} cover={deal.cover} />}
      meta={formatMoney(deal.net)}
      status={deal.price}
      action={
        <Badge tone={statusTone(deal.status)} size="sm">
          {deal.status}
        </Badge>
      }
    />
  );
}

export default function PreviewClient() {
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const [flightStart, setFlightStart] = useState<Date | undefined>(FLIGHT_START);
  const filledShare = Math.round((CAMPAIGN.filled / CAMPAIGN.budget) * 100);
  const visibleFlights = useMemo(
    () => flightsOnOrAfter(FLIGHTS, flightStart ? isoFromDate(flightStart) : undefined),
    [flightStart],
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add(displayFont.variable, bodyFont.variable);
    return () => {
      delete root.dataset.designPreview;
      root.classList.remove(displayFont.variable, bodyFont.variable);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.designPreview = "ink-gold";
  }, []);

  return (
    <div
      className={`${displayFont.variable} ${bodyFont.variable} ${styles.page}`}
      data-design-preview="ink-gold"
    >
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <img src="/mark.png" alt="" width={28} height={28} />
            taylslate
          </div>
          <nav className={styles.nav} aria-label="Brand">
            {NAV.map((item) => {
              const Icon = ICONS[item.iconKey];
              const current = item.href === "/deals";
              return (
                <button
                  key={item.href}
                  type="button"
                  className={current ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
                  aria-current={current ? "page" : undefined}
                >
                  {Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className={styles.workspace}>
            <div className={styles.workspaceName}>Sauna Box</div>
            <div className={styles.workspaceMeta}>Brand workspace</div>
          </div>
        </aside>

        <main className={styles.main}>
          <section className={styles.hero} aria-labelledby="next-action-title">
            <div>
              <h1 id="next-action-title">{CAMPAIGN.name}</h1>
              <p className={styles.lede}>
                {SHOWS.length} shows matched. {formatMoney(CAMPAIGN.filled)} of the{" "}
                {formatMoney(CAMPAIGN.budget)} test budget is filled.
              </p>
              <div className={styles.budget}>
                <div className={styles.figures}>
                  <div>
                    <div className={styles.figure}>{formatMoney(CAMPAIGN.filled)}</div>
                    <div className={styles.figureLabel}>Filled</div>
                  </div>
                  <div>
                    <div className={styles.figure}>{formatMoney(budgetRemaining)}</div>
                    <div className={styles.figureLabel}>Still open</div>
                  </div>
                </div>
                <div
                  className={styles.meter}
                  role="meter"
                  aria-label="Budget filled"
                  aria-valuemin={0}
                  aria-valuemax={CAMPAIGN.budget}
                  aria-valuenow={CAMPAIGN.filled}
                  aria-valuetext={`${filledShare}% filled`}
                >
                  <span style={{ width: `${filledShare}%` }} />
                </div>
              </div>
              <div className={styles.actions}>
                <Button
                  type="button"
                  size="lg"
                  className={styles.primary}
                  disabled={queued}
                  onClick={() => setOpen(true)}
                >
                  {queued ? "Outreach queued" : PRIMARY_ACTION}
                </Button>
                {queued ? <p className={styles.note}>Queued in this preview. Nothing was sent.</p> : null}
              </div>
            </div>
            <div>
              <h2 className={styles.sectionTitle}>Matched shows</h2>
              <div className={styles.showGrid}>
                {SHOWS.map((show) => (
                  <Card
                    key={show.id}
                    title={show.name}
                    description={show.note}
                    media={<CoverArt name={show.name} cover={show.cover} />}
                  />
                ))}
              </div>
            </div>
          </section>

          <section aria-labelledby="pipeline-title">
            <h2 id="pipeline-title" className={styles.sectionTitle}>
              Deal pipeline
            </h2>
            <div className={styles.board}>
              {PIPELINE_COLUMNS.map((column) => {
                const deals = dealsInColumn(column.key);
                return (
                  <div key={column.key} className={styles.column}>
                    <div className={styles.columnHead}>
                      <span>{column.label}</span>
                      <span className={styles.columnCount}>
                        {deals.length} · {formatMoney(columnNet(column.key))}
                      </span>
                    </div>
                    {deals.map((deal) => (
                      <DealCard key={deal.id} deal={deal} />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="flight-title">
            <h2 id="flight-title" className={styles.sectionTitle}>
              Upcoming reads
            </h2>
            <div className={styles.flight}>
              <DatePicker
                label="Flight starts"
                value={flightStart}
                onChange={setFlightStart}
                description="Reads on or after this date stay in the table."
              />
              <div className={styles.tableWrap}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Show</TableHead>
                      <TableHead>Placement</TableHead>
                      <TableHead>Air date</TableHead>
                      <TableHead>Spots</TableHead>
                      <TableHead>Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleFlights.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>No reads on or after that date.</TableCell>
                      </TableRow>
                    ) : (
                      visibleFlights.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.show}</TableCell>
                          <TableCell>{row.placement}</TableCell>
                          <TableCell>{formatAirDate(row.airDate)}</TableCell>
                          <TableCell>{row.spots}</TableCell>
                          <TableCell>{formatMoney(row.net)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>
        </main>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Send outreach"
          description="Queue pitches for the six matched shows. This preview does not email anyone."
        >
          <ul className={styles.dialogList}>
            {SHOWS.map((show) => (
              <li key={show.id}>{show.name}</li>
            ))}
          </ul>
          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className={styles.primary}
              onClick={() => {
                setQueued(true);
                setOpen(false);
              }}
            >
              Queue pitches
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
