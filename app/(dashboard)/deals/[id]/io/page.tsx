"use client";

import { useState, useEffect, use } from "react";
import IOGeneratorForm from "@/components/io/IOGeneratorForm";
import Link from "next/link";
import type { Deal, Show, InsertionOrder, Profile } from "@/lib/data/types";

interface DealApiResponse {
  deal: Deal & {
    show_name?: string;
    brand_name?: string;
    insertion_order?: InsertionOrder & { line_items: InsertionOrder["line_items"] };
  };
}

interface IOApiResponse {
  io: InsertionOrder;
}

export default function IOPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [deal, setDeal] = useState<Deal | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [existingIO, setExistingIO] = useState<InsertionOrder | undefined>(undefined);
  const [brand, setBrand] = useState<Profile | null>(null);
  const [agency, setAgency] = useState<Profile | undefined>(undefined);
  const [agent, setAgent] = useState<Profile | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // 1. Fetch deal with relations
        const dealRes = await fetch(`/api/deals/${id}`);
        if (!dealRes.ok) {
          const data = await dealRes.json();
          throw new Error(data.error || "Failed to load deal");
        }
        const { deal: dealData } = (await dealRes.json()) as DealApiResponse;
        setDeal(dealData);

        // 2. Try to fetch existing IO
        let io: InsertionOrder | undefined = dealData.insertion_order ?? undefined;

        if (!io) {
          const ioRes = await fetch(`/api/deals/${id}/io`);
          if (ioRes.ok) {
            const ioData = (await ioRes.json()) as IOApiResponse;
            io = ioData.io;
          } else if (ioRes.status === 404) {
            // No IO exists — generate one
            const genRes = await fetch(`/api/deals/${id}/io/generate`, { method: "POST" });
            if (genRes.ok) {
              const genData = (await genRes.json()) as IOApiResponse;
              io = genData.io;
            } else if (genRes.status === 409) {
              // IO already exists (race condition) — fetch it
              const retryRes = await fetch(`/api/deals/${id}/io`);
              if (retryRes.ok) {
                const retryData = (await retryRes.json()) as IOApiResponse;
                io = retryData.io;
              }
            } else {
              const genErr = await genRes.json();
              // Non-fatal — IO generation failed but we can still show the form
              console.warn("IO generation failed:", genErr.error);
            }
          }
        }

        setExistingIO(io);

        // 3. Build minimal Show object from deal data
        // The form only uses: name, platform, episode_cadence (for adding line items)
        const minimalShow: Show = {
          id: dealData.show_id,
          name: dealData.show_name ?? io?.line_items?.[0]?.show_name ?? "Unknown Show",
          platform: io?.line_items?.[0]?.format ?? "podcast",
          description: "",
          categories: [],
          tags: [],
          contact: { name: "", email: "", method: "email" as const },
          audience_size: dealData.guaranteed_downloads ?? 0,
          demographics: {},
          audience_interests: [],
          rate_card: {},
          price_type: dealData.price_type ?? "cpm",
          ad_formats: [],
          episode_cadence: "weekly",
          avg_episode_length_min: 0,
          current_sponsors: [],
          is_claimed: false,
          is_verified: false,
          created_at: "",
          updated_at: "",
        };
        setShow(minimalShow);

        // 4. Build minimal Profile objects from IO or deal data
        const minimalBrand: Profile = {
          id: dealData.brand_id,
          email: io?.advertiser_contact_email ?? "",
          full_name: io?.advertiser_contact_name ?? dealData.brand_name ?? "",
          company_name: io?.advertiser_name ?? dealData.brand_name ?? "",
          role: "brand",
          tier: "free",
          created_at: "",
        };
        setBrand(minimalBrand);

        if (dealData.agency_id) {
          const minimalAgency: Profile = {
            id: dealData.agency_id,
            email: io?.agency_contact_email ?? "",
            full_name: io?.agency_contact_name ?? "",
            company_name: io?.agency_name ?? "",
            role: "agency",
            tier: "free",
            created_at: "",
          };
          setAgency(minimalAgency);
        }

        if (dealData.agent_id) {
          const minimalAgent: Profile = {
            id: dealData.agent_id,
            email: io?.publisher_contact_email ?? "",
            full_name: io?.publisher_contact_name ?? "",
            company_name: io?.publisher_name ?? "",
            role: "agent",
            tier: "free",
            created_at: "",
          };
          setAgent(minimalAgent);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load IO data");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 max-w-4xl">
        <Link
          href="/deals"
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-3"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All Deals
        </Link>
        <div className="flex items-center gap-3 mt-8">
          <div className="w-5 h-5 border-2 border-[var(--brand-blue)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[var(--brand-text-secondary)]">Loading insertion order...</span>
        </div>
      </div>
    );
  }

  if (error || !deal || !show || !brand) {
    return (
      <div className="p-8 max-w-4xl">
        <Link
          href="/deals"
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-3"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All Deals
        </Link>
        <div className="mt-8 p-4 rounded-xl bg-[var(--brand-error)]/[0.06] border border-[var(--brand-error)]/20">
          <p className="text-sm font-medium text-[var(--brand-error)]">
            {error || "Deal not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <IOGeneratorForm
      deal={deal}
      show={show}
      existingIO={existingIO}
      brand={brand}
      agency={agency}
      agent={agent}
    />
  );
}
