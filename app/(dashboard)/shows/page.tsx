"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Show, Platform, PriceType } from "@/lib/data/types";
import {
  parseCSV,
  type ParsedCSVRow,
} from "@/lib/utils/fuzzy-match";

type AgentShow = Show & { commission_rate?: number; last_api_refresh?: string };

type EnrichStatus = "fresh" | "stale" | "never";

function getEnrichStatus(show: AgentShow): EnrichStatus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refresh = show.last_api_refresh ?? (show as any).last_api_refresh;
  if (!refresh) return "never";
  const refreshDate = new Date(refresh as string);
  const daysSince = (Date.now() - refreshDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return "fresh";
  return "stale";
}

const enrichColors: Record<EnrichStatus, { dot: string; label: string }> = {
  fresh: { dot: "var(--brand-success)", label: "Enriched" },
  stale: { dot: "var(--brand-warning)", label: "Stale" },
  never: { dot: "var(--brand-text-muted)", label: "Not enriched" },
};

export default function ShowsPage() {
  const [showList, setShowList] = useState<AgentShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingShow, setEditingShow] = useState<AgentShow | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [enrichingAll, setEnrichingAll] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    async function fetchShows() {
      try {
        const res = await fetch("/api/shows");
        if (res.ok) {
          const data = await res.json();
          setShowList(data);
        }
      } catch (err) {
        console.error("Failed to fetch shows:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchShows();
  }, []);

  // Form state
  const [formName, setFormName] = useState("");
  const [formPlatform, setFormPlatform] = useState<Platform>("podcast");
  const [formDescription, setFormDescription] = useState("");
  const [formAudienceSize, setFormAudienceSize] = useState<number | "">("");
  const [formCategories, setFormCategories] = useState("");
  const [formEpisodeCadence, setFormEpisodeCadence] = useState<Show["episode_cadence"]>("weekly");
  const [formPriceType, setFormPriceType] = useState<PriceType>("cpm");
  const [formMidrollCpm, setFormMidrollCpm] = useState<number | "">("");
  const [formPrerollCpm, setFormPrerollCpm] = useState<number | "">("");
  const [formPostrollCpm, setFormPostrollCpm] = useState<number | "">("");
  const [formFlatRate, setFormFlatRate] = useState<number | "">("");
  const [formCommissionRate, setFormCommissionRate] = useState<number | "">("");
  const [formContactName, setFormContactName] = useState("");
  const [formContactEmail, setFormContactEmail] = useState("");
  const [formContactMethod, setFormContactMethod] = useState<Show["contact"]["method"]>("email");
  const [formAvailableSlots, setFormAvailableSlots] = useState<number | "">("");

  const filteredShows = showList.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setFormName(""); setFormPlatform("podcast"); setFormDescription("");
    setFormAudienceSize(""); setFormCategories(""); setFormEpisodeCadence("weekly");
    setFormPriceType("cpm"); setFormMidrollCpm(""); setFormPrerollCpm("");
    setFormPostrollCpm(""); setFormFlatRate(""); setFormCommissionRate("");
    setFormContactName(""); setFormContactEmail(""); setFormContactMethod("email");
    setFormAvailableSlots("");
  };

  const populateForm = (show: AgentShow) => {
    setFormName(show.name); setFormPlatform(show.platform); setFormDescription(show.description);
    setFormAudienceSize(show.audience_size); setFormCategories(show.categories.join(", "));
    setFormEpisodeCadence(show.episode_cadence); setFormPriceType(show.price_type);
    setFormMidrollCpm(show.rate_card.midroll_cpm ?? ""); setFormPrerollCpm(show.rate_card.preroll_cpm ?? "");
    setFormPostrollCpm(show.rate_card.postroll_cpm ?? ""); setFormFlatRate(show.rate_card.flat_rate ?? "");
    setFormCommissionRate(show.commission_rate != null ? show.commission_rate * 100 : "");
    setFormContactName(show.contact.name); setFormContactEmail(show.contact.email);
    setFormContactMethod(show.contact.method); setFormAvailableSlots(show.available_slots ?? "");
  };

  const buildShowFromForm = (): AgentShow => {
    const now = new Date().toISOString();
    return {
      id: editingShow?.id ?? `show-${Date.now()}`,
      name: formName, platform: formPlatform, description: formDescription,
      categories: formCategories.split(",").map((c) => c.trim()).filter(Boolean),
      tags: editingShow?.tags ?? [], contact: { name: formContactName, email: formContactEmail, method: formContactMethod },
      agent_id: editingShow?.agent_id, audience_size: (formAudienceSize as number) || 0,
      demographics: editingShow?.demographics ?? {}, audience_interests: editingShow?.audience_interests ?? [],
      rate_card: { preroll_cpm: formPrerollCpm ? Number(formPrerollCpm) : undefined, midroll_cpm: formMidrollCpm ? Number(formMidrollCpm) : undefined, postroll_cpm: formPostrollCpm ? Number(formPostrollCpm) : undefined, flat_rate: formFlatRate ? Number(formFlatRate) : undefined },
      price_type: formPriceType, ad_formats: editingShow?.ad_formats ?? ["host_read"],
      episode_cadence: formEpisodeCadence, avg_episode_length_min: editingShow?.avg_episode_length_min ?? 60,
      current_sponsors: editingShow?.current_sponsors ?? [], is_claimed: true, is_verified: false,
      available_slots: formAvailableSlots ? Number(formAvailableSlots) : undefined,
      created_at: editingShow?.created_at ?? now, updated_at: now,
      commission_rate: formCommissionRate ? Number(formCommissionRate) / 100 : undefined,
    };
  };

  const handleAdd = () => { resetForm(); setEditingShow(null); setShowAddForm(true); };
  const handleEdit = (show: AgentShow) => { setEditingShow(show); populateForm(show); setShowEditForm(true); };

  const handleSaveAdd = async () => {
    if (!formName) return;
    const newShow = buildShowFromForm();
    try {
      const res = await fetch("/api/shows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newShow) });
      if (res.ok) {
        const saved = await res.json();
        setShowList([...showList, saved]);
      } else {
        setShowList([...showList, newShow]);
      }
    } catch {
      setShowList([...showList, newShow]);
    }
    setShowAddForm(false);
    resetForm();
  };

  const handleSaveEdit = async () => {
    if (!formName || !editingShow) return;
    const updated = buildShowFromForm();
    setShowList(showList.map((s) => (s.id === editingShow.id ? updated : s)));
    setShowEditForm(false); setEditingShow(null); resetForm();
  };

  const handleRemove = (id: string) => {
    setShowList(showList.filter((s) => s.id !== id));
    setRemovingId(null);
  };

  // Enrich single show
  const handleEnrich = async (showId: string) => {
    setEnrichingId(showId);
    try {
      const res = await fetch(`/api/shows/${showId}/enrich`, { method: "POST" });
      if (res.ok) {
        const enriched = await res.json();
        setShowList((prev) => prev.map((s) => s.id === showId ? { ...s, ...enriched, last_api_refresh: new Date().toISOString() } : s));
      }
    } catch (err) {
      console.error("Enrich failed:", err);
    } finally {
      setEnrichingId(null);
    }
  };

  // Enrich all shows
  const handleEnrichAll = async () => {
    setEnrichingAll(true);
    setEnrichProgress({ done: 0, total: showList.length });

    try {
      const res = await fetch("/api/shows/enrich-batch", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.results) {
          setShowList((prev) =>
            prev.map((s) => {
              const enriched = data.results.find((r: Record<string, unknown>) => r.id === s.id);
              return enriched ? { ...s, ...enriched, last_api_refresh: new Date().toISOString() } : s;
            })
          );
        }
        setEnrichProgress({ done: showList.length, total: showList.length });
      } else if (res.status === 404) {
        // API not ready yet — enrich one by one as fallback
        for (let i = 0; i < showList.length; i++) {
          try {
            const r = await fetch(`/api/shows/${showList[i].id}/enrich`, { method: "POST" });
            if (r.ok) {
              const enriched = await r.json();
              setShowList((prev) => prev.map((s) => s.id === showList[i].id ? { ...s, ...enriched, last_api_refresh: new Date().toISOString() } : s));
            }
          } catch { /* continue */ }
          setEnrichProgress({ done: i + 1, total: showList.length });
        }
      }
    } catch (err) {
      console.error("Enrich all failed:", err);
    } finally {
      setEnrichingAll(false);
      setTimeout(() => setEnrichProgress(null), 2000);
    }
  };

  const inputClass = "w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all";

  const renderForm = (onSave: () => void, onCancel: () => void, title: string) => (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-1">{title}</h3>
        <p className="text-sm text-[var(--brand-text-secondary)] mb-5">
          {title === "Add Show" ? "Add a new podcast or YouTube channel to your roster." : "Update show details."}
        </p>

        <div className="space-y-5">
          {/* Basic */}
          <div>
            <label className="block text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Basic Info</label>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Show Name</label>
                <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., The Daily Podcast" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Platform</label>
                <div className="flex gap-3">
                  {(["podcast", "youtube"] as Platform[]).map((p) => (
                    <button key={p} type="button" onClick={() => setFormPlatform(p)}
                      className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${formPlatform === p ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]" : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"}`}>
                      {p === "podcast" ? "Podcast" : "YouTube"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Description <span className="text-[var(--brand-text-muted)] font-normal ml-1">(optional)</span></label>
                <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2} placeholder="Brief show description" className={`${inputClass} resize-none`} />
              </div>
            </div>
          </div>

          {/* Audience */}
          <div>
            <label className="block text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Audience</label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">{formPlatform === "podcast" ? "Avg Downloads/Ep" : "Avg Views"}</label>
                  <input type="number" value={formAudienceSize} onChange={(e) => setFormAudienceSize(e.target.value ? Number(e.target.value) : "")} placeholder="35000" min="0" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Episode Cadence</label>
                  <select value={formEpisodeCadence} onChange={(e) => setFormEpisodeCadence(e.target.value as Show["episode_cadence"])} className={inputClass}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Categories</label>
                <input type="text" value={formCategories} onChange={(e) => setFormCategories(e.target.value)} placeholder="Comedy, True Crime, Business" className={inputClass} />
                <p className="text-xs text-[var(--brand-text-muted)] mt-1">Comma-separated</p>
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div>
            <label className="block text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Pricing</label>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Price Type</label>
                <div className="flex gap-3">
                  {(["cpm", "flat_rate"] as PriceType[]).map((pt) => (
                    <button key={pt} type="button" onClick={() => setFormPriceType(pt)}
                      className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${formPriceType === pt ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]" : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"}`}>
                      {pt === "cpm" ? "CPM" : "Flat Rate"}
                    </button>
                  ))}
                </div>
              </div>
              {formPriceType === "cpm" ? (
                <div className="grid grid-cols-3 gap-3">
                  {([["Pre-roll", formPrerollCpm, setFormPrerollCpm] as const, ["Mid-roll", formMidrollCpm, setFormMidrollCpm] as const, ["Post-roll", formPostrollCpm, setFormPostrollCpm] as const]).map(([label, val, setter]) => (
                    <div key={label}>
                      <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">{label} CPM</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
                        <input type="number" value={val} onChange={(e) => setter(e.target.value ? Number(e.target.value) : "")} placeholder="25" min="0" step="0.01" className={`${inputClass} pl-7`} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Flat Rate</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
                    <input type="number" value={formFlatRate} onChange={(e) => setFormFlatRate(e.target.value ? Number(e.target.value) : "")} placeholder="5000" min="0" step="1" className={`${inputClass} pl-7`} />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Commission Rate <span className="text-[var(--brand-text-muted)] font-normal ml-1">(%)</span></label>
                <div className="relative">
                  <input type="number" value={formCommissionRate} onChange={(e) => setFormCommissionRate(e.target.value ? Number(e.target.value) : "")} placeholder="15" min="0" max="100" step="1" className={`${inputClass} pr-8`} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div>
            <label className="block text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Contact</label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Contact Name</label>
                  <input type="text" value={formContactName} onChange={(e) => setFormContactName(e.target.value)} placeholder="John Smith" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Contact Email</label>
                  <input type="email" value={formContactEmail} onChange={(e) => setFormContactEmail(e.target.value)} placeholder="john@show.com" className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Contact Method</label>
                <select value={formContactMethod} onChange={(e) => setFormContactMethod(e.target.value as Show["contact"]["method"])} className={inputClass}>
                  <option value="email">Email</option>
                  <option value="form">Form</option>
                  <option value="network_rep">Network Rep</option>
                  <option value="agent">Agent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Availability */}
          <div>
            <label className="block text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Availability</label>
            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Available Slots (next 30 days)</label>
              <input type="number" value={formAvailableSlots} onChange={(e) => setFormAvailableSlots(e.target.value ? Number(e.target.value) : "")} placeholder="4" min="0" className={inputClass} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 justify-end mt-6 pt-5 border-t border-[var(--brand-border)]">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors">Cancel</button>
          <button onClick={onSave} disabled={!formName} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50">
            {title === "Add Show" ? "Add Show" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Shows</h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            Manage the podcasts and YouTube channels you represent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showList.length > 0 && (
            <button
              onClick={handleEnrichAll}
              disabled={enrichingAll}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] text-sm font-medium transition-colors disabled:opacity-50"
            >
              {enrichingAll ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)] rounded-full animate-spin" />
                  Enriching...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9" />
                  </svg>
                  Enrich All
                </>
              )}
            </button>
          )}
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" x2="12" y1="3" y2="15" />
            </svg>
            Import Shows
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Show
          </button>
        </div>
      </div>

      {/* Enrich progress bar */}
      {enrichProgress && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)]">
          <div className="flex items-center justify-between text-xs text-[var(--brand-text-secondary)] mb-1.5">
            <span>Enriching shows...</span>
            <span>{enrichProgress.done}/{enrichProgress.total}</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--brand-border)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--brand-blue)] rounded-full transition-all duration-300"
              style={{ width: `${enrichProgress.total > 0 ? (enrichProgress.done / enrichProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-5">
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shows..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--brand-border)]" />
                <div className="flex-1">
                  <div className="h-4 w-40 bg-[var(--brand-border)] rounded mb-2" />
                  <div className="h-3 w-64 bg-[var(--brand-border)] rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredShows.length > 0 ? (
        <div className="space-y-3">
          {filteredShows.map((show) => {
            const isPodcast = show.platform === "podcast";
            const displayRate = isPodcast
              ? show.rate_card.midroll_cpm ? `$${show.rate_card.midroll_cpm}` : "\u2014"
              : show.rate_card.flat_rate ? `$${show.rate_card.flat_rate.toLocaleString()}` : "\u2014";
            const rateLabel = isPodcast ? "mid-roll CPM" : "flat rate";
            const audienceLabel = isPodcast ? "downloads/ep" : "avg views";
            const enrichStatus = getEnrichStatus(show);
            const enrichInfo = enrichColors[enrichStatus];

            return (
              <div
                key={show.id}
                className="flex items-center justify-between p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isPodcast ? "bg-gradient-to-br from-[var(--brand-blue)]/10 to-[var(--brand-teal)]/10" : "bg-gradient-to-br from-[var(--brand-error)]/10 to-[var(--brand-orange)]/10"}`}>
                    {isPodcast ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-error)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[var(--brand-text)] truncate">{show.name}</h3>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0 ${isPodcast ? "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]" : "bg-[var(--brand-error)]/10 text-[var(--brand-error)]"}`}>
                        {show.platform}
                      </span>
                      {/* Enrichment status dot */}
                      <div className="flex items-center gap-1 shrink-0" title={enrichInfo.label}>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: enrichInfo.dot }} />
                        <span className="text-[10px] text-[var(--brand-text-muted)]">{enrichInfo.label}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-[var(--brand-text-muted)]">
                        {show.audience_size >= 1000
                          ? `${(show.audience_size / 1000).toFixed(show.audience_size >= 10000 ? 0 : 1)}K`
                          : show.audience_size} {audienceLabel}
                      </span>
                      {show.categories.length > 0 && (
                        <span className="text-xs text-[var(--brand-text-muted)]">
                          {show.categories.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0 ml-4">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--brand-text)]">{displayRate}</div>
                    <div className="text-xs text-[var(--brand-text-muted)]">{rateLabel}</div>
                  </div>

                  {/* Categories as tags */}
                  {show.categories.length > 0 && (
                    <div className="hidden lg:flex items-center gap-1">
                      {show.categories.slice(0, 2).map((cat) => (
                        <span key={cat} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--brand-surface)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  {removingId === show.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--brand-text-muted)]">Remove?</span>
                      <button onClick={() => setRemovingId(null)} className="px-2.5 py-1 rounded-lg border border-[var(--brand-border)] text-xs font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors">Cancel</button>
                      <button onClick={() => handleRemove(show.id)} className="px-2.5 py-1 rounded-lg bg-[var(--brand-error)] text-white text-xs font-medium hover:opacity-90 transition-colors">Remove</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEnrich(show.id)}
                        disabled={enrichingId === show.id}
                        className="px-3 py-1.5 rounded-lg border border-[var(--brand-border)] text-xs font-medium text-[var(--brand-text-secondary)] hover:border-[var(--brand-teal)] hover:text-[var(--brand-teal)] transition-all disabled:opacity-50"
                      >
                        {enrichingId === show.id ? (
                          <div className="w-3 h-3 border-2 border-[var(--brand-teal)]/30 border-t-[var(--brand-teal)] rounded-full animate-spin" />
                        ) : (
                          "Enrich"
                        )}
                      </button>
                      <button onClick={() => handleEdit(show)} className="px-3 py-1.5 rounded-lg border border-[var(--brand-border)] text-xs font-medium text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] transition-all">Edit</button>
                      <button onClick={() => setRemovingId(show.id)} className="p-1.5 rounded-lg text-[var(--brand-text-muted)] hover:text-[var(--brand-error)] hover:bg-[var(--brand-error)]/[0.06] transition-all">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : showList.length > 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] border-dashed">
          <p className="text-sm text-[var(--brand-text-muted)]">No shows match &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">No shows yet</h3>
          <p className="text-sm text-[var(--brand-text-muted)] mb-6 max-w-sm text-center">
            Import your roster to get started, or add shows manually.
          </p>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] text-sm font-medium transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
              Import Shows
            </button>
            <button onClick={handleAdd} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Your First Show
            </button>
          </div>
        </div>
      )}

      {/* Add Show Modal */}
      {showAddForm && renderForm(handleSaveAdd, () => { setShowAddForm(false); resetForm(); }, "Add Show")}

      {/* Edit Show Modal */}
      {showEditForm && renderForm(handleSaveEdit, () => { setShowEditForm(false); setEditingShow(null); resetForm(); }, "Edit Show")}

      {/* Import Shows Modal */}
      {showImportModal && (
        <ImportShowsModal
          onClose={() => setShowImportModal(false)}
          onImported={(imported) => {
            setShowList((prev) => [...prev, ...imported]);
            setShowImportModal(false);
          }}
        />
      )}
    </div>
  );
}

// ---- Import Modal Component ----

function ImportShowsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (shows: AgentShow[]) => void;
}) {
  const [parsedRows, setParsedRows] = useState<ParsedCSVRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    setIsProcessing(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setError("No valid show data found in CSV.");
      } else {
        setParsedRows(rows);
      }
    } catch {
      setError("Failed to parse CSV file.");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
      processFile(file);
    } else {
      setError("Please upload a CSV file.");
    }
  }, [processFile]);

  const handleImport = async () => {
    if (parsedRows.length === 0) return;
    setIsImporting(true);
    setError(null);

    const showsToImport = parsedRows.map((row) => ({
      name: row.show_name,
      platform: (row.channel_type.toLowerCase() === "youtube" ? "youtube" : "podcast") as Platform,
      description: "",
      categories: row.category ? [row.category] : [],
      audience_size: row.downloads,
      rate_card: row.cpm > 0 ? { midroll_cpm: row.cpm } : row.price_per_spot > 0 ? { flat_rate: row.price_per_spot } : {},
      price_type: (row.channel_type.toLowerCase() === "youtube" ? "flat_rate" : "cpm") as "cpm" | "flat_rate",
    }));

    try {
      const res = await fetch("/api/shows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shows: showsToImport }),
      });

      if (res.ok) {
        const data = await res.json();
        onImported(data.imported ?? []);
      } else if (res.status === 404) {
        setError("Import API not available yet. Shows will be available soon.");
      } else {
        setError("Failed to import shows.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-1">Import Shows</h3>
        <p className="text-sm text-[var(--brand-text-secondary)] mb-5">Upload a CSV file with your show roster.</p>

        {parsedRows.length === 0 ? (
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${dragActive ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04]" : "border-[var(--brand-border)] hover:border-[var(--brand-blue)]/40"}`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            {isProcessing ? (
              <div>
                <div className="w-8 h-8 border-2 border-[var(--brand-blue)]/20 border-t-[var(--brand-blue)] rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-[var(--brand-text)]">Parsing {fileName}...</p>
              </div>
            ) : (
              <div>
                <div className="w-10 h-10 rounded-lg bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                </div>
                <p className="text-sm text-[var(--brand-text)] mb-1">Drop CSV here or click to browse</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm text-[var(--brand-blue)] hover:underline"
                >
                  Choose file
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-[var(--brand-text)]">{parsedRows.length} shows found</p>
              <button onClick={() => { setParsedRows([]); setFileName(""); }} className="text-xs text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]">Clear</button>
            </div>
            <div className="max-h-48 overflow-y-auto border border-[var(--brand-border)] rounded-lg">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--brand-border)]">
                  {parsedRows.map((row, i) => (
                    <tr key={i} className="hover:bg-[var(--brand-surface)]">
                      <td className="px-3 py-2 font-medium text-[var(--brand-text)]">{row.show_name}</td>
                      <td className="px-3 py-2 text-right text-[var(--brand-text-muted)] text-xs">
                        {row.downloads >= 1000 ? `${(row.downloads / 1000).toFixed(0)}K` : row.downloads}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 p-2.5 rounded-lg bg-[var(--brand-error)]/10 text-[var(--brand-error)] text-sm">{error}</div>
        )}

        <div className="flex items-center gap-3 justify-end mt-5 pt-4 border-t border-[var(--brand-border)]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors">Cancel</button>
          {parsedRows.length > 0 && (
            <button onClick={handleImport} disabled={isImporting} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50">
              {isImporting ? (
                <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importing...</>
              ) : (
                `Import ${parsedRows.length} Shows`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
