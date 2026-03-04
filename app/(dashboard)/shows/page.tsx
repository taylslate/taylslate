"use client";

import { useState } from "react";
import { getAgentShows } from "@/lib/data";
import type { Show, Platform, PriceType } from "@/lib/data";

type AgentShow = Show & { commission_rate?: number };

const initialShows = getAgentShows("user-agent-001");

export default function ShowsPage() {
  const [showList, setShowList] = useState<AgentShow[]>(initialShows);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingShow, setEditingShow] = useState<AgentShow | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    setFormName("");
    setFormPlatform("podcast");
    setFormDescription("");
    setFormAudienceSize("");
    setFormCategories("");
    setFormEpisodeCadence("weekly");
    setFormPriceType("cpm");
    setFormMidrollCpm("");
    setFormPrerollCpm("");
    setFormPostrollCpm("");
    setFormFlatRate("");
    setFormCommissionRate("");
    setFormContactName("");
    setFormContactEmail("");
    setFormContactMethod("email");
    setFormAvailableSlots("");
  };

  const populateForm = (show: AgentShow) => {
    setFormName(show.name);
    setFormPlatform(show.platform);
    setFormDescription(show.description);
    setFormAudienceSize(show.audience_size);
    setFormCategories(show.categories.join(", "));
    setFormEpisodeCadence(show.episode_cadence);
    setFormPriceType(show.price_type);
    setFormMidrollCpm(show.rate_card.midroll_cpm ?? "");
    setFormPrerollCpm(show.rate_card.preroll_cpm ?? "");
    setFormPostrollCpm(show.rate_card.postroll_cpm ?? "");
    setFormFlatRate(show.rate_card.flat_rate ?? "");
    setFormCommissionRate(show.commission_rate != null ? show.commission_rate * 100 : "");
    setFormContactName(show.contact.name);
    setFormContactEmail(show.contact.email);
    setFormContactMethod(show.contact.method);
    setFormAvailableSlots(show.available_slots ?? "");
  };

  const buildShowFromForm = (): AgentShow => {
    const now = new Date().toISOString();
    return {
      id: editingShow?.id ?? `show-${Date.now()}`,
      name: formName,
      platform: formPlatform,
      description: formDescription,
      categories: formCategories.split(",").map((c) => c.trim()).filter(Boolean),
      tags: editingShow?.tags ?? [],
      contact: {
        name: formContactName,
        email: formContactEmail,
        method: formContactMethod,
      },
      agent_id: "user-agent-001",
      audience_size: (formAudienceSize as number) || 0,
      demographics: editingShow?.demographics ?? {},
      audience_interests: editingShow?.audience_interests ?? [],
      rate_card: {
        preroll_cpm: formPrerollCpm ? Number(formPrerollCpm) : undefined,
        midroll_cpm: formMidrollCpm ? Number(formMidrollCpm) : undefined,
        postroll_cpm: formPostrollCpm ? Number(formPostrollCpm) : undefined,
        flat_rate: formFlatRate ? Number(formFlatRate) : undefined,
      },
      price_type: formPriceType,
      ad_formats: editingShow?.ad_formats ?? ["host_read"],
      episode_cadence: formEpisodeCadence,
      avg_episode_length_min: editingShow?.avg_episode_length_min ?? 60,
      current_sponsors: editingShow?.current_sponsors ?? [],
      is_claimed: true,
      is_verified: false,
      available_slots: formAvailableSlots ? Number(formAvailableSlots) : undefined,
      created_at: editingShow?.created_at ?? now,
      updated_at: now,
      commission_rate: formCommissionRate ? Number(formCommissionRate) / 100 : undefined,
    };
  };

  const handleAdd = () => {
    resetForm();
    setEditingShow(null);
    setShowAddForm(true);
  };

  const handleEdit = (show: AgentShow) => {
    setEditingShow(show);
    populateForm(show);
    setShowEditForm(true);
  };

  const handleSaveAdd = () => {
    if (!formName) return;
    setShowList([...showList, buildShowFromForm()]);
    setShowAddForm(false);
    resetForm();
  };

  const handleSaveEdit = () => {
    if (!formName || !editingShow) return;
    const updated = buildShowFromForm();
    setShowList(showList.map((s) => (s.id === editingShow.id ? updated : s)));
    setShowEditForm(false);
    setEditingShow(null);
    resetForm();
  };

  const handleRemove = (id: string) => {
    setShowList(showList.filter((s) => s.id !== id));
    setRemovingId(null);
  };

  const inputClass =
    "w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all";

  const renderForm = (onSave: () => void, onCancel: () => void, title: string) => (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
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
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., The Daily Podcast"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Platform</label>
                <div className="flex gap-3">
                  {(["podcast", "youtube"] as Platform[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFormPlatform(p)}
                      className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        formPlatform === p
                          ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                          : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                      }`}
                    >
                      {p === "podcast" ? "Podcast" : "YouTube"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
                  Description <span className="text-[var(--brand-text-muted)] font-normal ml-1">(optional)</span>
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  placeholder="Brief show description"
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>
          </div>

          {/* Audience */}
          <div>
            <label className="block text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Audience</label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
                    {formPlatform === "podcast" ? "Avg Downloads/Ep" : "Avg Views"}
                  </label>
                  <input
                    type="number"
                    value={formAudienceSize}
                    onChange={(e) => setFormAudienceSize(e.target.value ? Number(e.target.value) : "")}
                    placeholder="35000"
                    min="0"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Episode Cadence</label>
                  <select
                    value={formEpisodeCadence}
                    onChange={(e) => setFormEpisodeCadence(e.target.value as Show["episode_cadence"])}
                    className={inputClass}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Categories</label>
                <input
                  type="text"
                  value={formCategories}
                  onChange={(e) => setFormCategories(e.target.value)}
                  placeholder="Comedy, True Crime, Business"
                  className={inputClass}
                />
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
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setFormPriceType(pt)}
                      className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        formPriceType === pt
                          ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                          : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                      }`}
                    >
                      {pt === "cpm" ? "CPM" : "Flat Rate"}
                    </button>
                  ))}
                </div>
              </div>
              {formPriceType === "cpm" ? (
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ["Pre-roll", formPrerollCpm, setFormPrerollCpm] as const,
                    ["Mid-roll", formMidrollCpm, setFormMidrollCpm] as const,
                    ["Post-roll", formPostrollCpm, setFormPostrollCpm] as const,
                  ]).map(([label, val, setter]) => (
                    <div key={label}>
                      <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">{label} CPM</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
                        <input
                          type="number"
                          value={val}
                          onChange={(e) => setter(e.target.value ? Number(e.target.value) : "")}
                          placeholder="25"
                          min="0"
                          step="0.01"
                          className={`${inputClass} pl-7`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Flat Rate</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
                    <input
                      type="number"
                      value={formFlatRate}
                      onChange={(e) => setFormFlatRate(e.target.value ? Number(e.target.value) : "")}
                      placeholder="5000"
                      min="0"
                      step="1"
                      className={`${inputClass} pl-7`}
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
                  Commission Rate <span className="text-[var(--brand-text-muted)] font-normal ml-1">(%)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={formCommissionRate}
                    onChange={(e) => setFormCommissionRate(e.target.value ? Number(e.target.value) : "")}
                    placeholder="15"
                    min="0"
                    max="100"
                    step="1"
                    className={`${inputClass} pr-8`}
                  />
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
                  <input
                    type="text"
                    value={formContactName}
                    onChange={(e) => setFormContactName(e.target.value)}
                    placeholder="John Smith"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Contact Email</label>
                  <input
                    type="email"
                    value={formContactEmail}
                    onChange={(e) => setFormContactEmail(e.target.value)}
                    placeholder="john@show.com"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Contact Method</label>
                <select
                  value={formContactMethod}
                  onChange={(e) => setFormContactMethod(e.target.value as Show["contact"]["method"])}
                  className={inputClass}
                >
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
              <input
                type="number"
                value={formAvailableSlots}
                onChange={(e) => setFormAvailableSlots(e.target.value ? Number(e.target.value) : "")}
                placeholder="4"
                min="0"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end mt-6 pt-5 border-t border-[var(--brand-border)]">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!formName}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
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

      {filteredShows.length > 0 ? (
        <div className="space-y-3">
          {filteredShows.map((show) => {
            const isPodcast = show.platform === "podcast";
            const displayRate = isPodcast
              ? show.rate_card.midroll_cpm
                ? `$${show.rate_card.midroll_cpm}`
                : "\u2014"
              : show.rate_card.flat_rate
                ? `$${show.rate_card.flat_rate.toLocaleString()}`
                : "\u2014";
            const rateLabel = isPodcast ? "mid-roll CPM" : "flat rate";
            const audienceLabel = isPodcast ? "downloads/ep" : "avg views";
            const slotsAvailable = show.available_slots != null && show.available_slots > 0;

            return (
              <div
                key={show.id}
                className="flex items-center justify-between p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isPodcast
                      ? "bg-gradient-to-br from-[var(--brand-blue)]/10 to-[var(--brand-teal)]/10"
                      : "bg-gradient-to-br from-[var(--brand-error)]/10 to-[var(--brand-orange)]/10"
                  }`}>
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
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0 ${
                        isPodcast
                          ? "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                          : "bg-[var(--brand-error)]/10 text-[var(--brand-error)]"
                      }`}>
                        {show.platform}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-[var(--brand-text-muted)]">
                        {show.audience_size >= 1000
                          ? `${(show.audience_size / 1000).toFixed(show.audience_size >= 10000 ? 0 : 1)}K`
                          : show.audience_size} {audienceLabel}
                      </span>
                      <span className="text-xs text-[var(--brand-text-muted)]">
                        {show.categories.slice(0, 2).join(", ")}
                      </span>
                      {show.commission_rate != null && (
                        <span className="text-xs text-[var(--brand-text-muted)]">
                          {(show.commission_rate * 100).toFixed(0)}% commission
                        </span>
                      )}
                      {show.contact.name && (
                        <span className="text-xs text-[var(--brand-text-muted)]">
                          {show.contact.name}
                        </span>
                      )}
                      {show.contact.email && (
                        <span className="text-xs text-[var(--brand-text-muted)]">
                          {show.contact.email}
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
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    slotsAvailable
                      ? "bg-[var(--brand-teal)]/10 text-[var(--brand-teal)]"
                      : "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]"
                  }`}>
                    {slotsAvailable ? `${show.available_slots} slots` : "Full"}
                  </span>

                  {/* Edit / Remove */}
                  {removingId === show.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--brand-text-muted)]">Remove?</span>
                      <button
                        onClick={() => setRemovingId(null)}
                        className="px-2.5 py-1 rounded-lg border border-[var(--brand-border)] text-xs font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRemove(show.id)}
                        className="px-2.5 py-1 rounded-lg bg-[var(--brand-error)] text-white text-xs font-medium hover:opacity-90 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(show)}
                        className="px-3 py-1.5 rounded-lg border border-[var(--brand-border)] text-xs font-medium text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] transition-all"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setRemovingId(show.id)}
                        className="p-1.5 rounded-lg text-[var(--brand-text-muted)] hover:text-[var(--brand-error)] hover:bg-[var(--brand-error)]/[0.06] transition-all"
                      >
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
          <p className="text-sm text-[var(--brand-text-muted)]">
            No shows match &ldquo;{search}&rdquo;
          </p>
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
            Shows you represent will appear here.
          </p>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Your First Show
          </button>
        </div>
      )}

      {/* Add Show Modal */}
      {showAddForm && renderForm(handleSaveAdd, () => { setShowAddForm(false); resetForm(); }, "Add Show")}

      {/* Edit Show Modal */}
      {showEditForm && renderForm(handleSaveEdit, () => { setShowEditForm(false); setEditingShow(null); resetForm(); }, "Edit Show")}
    </div>
  );
}
