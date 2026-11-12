// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { OWNERSHIP_MESSAGES } from "@/lib/ownership/check";
import { hashOwnershipCode } from "@/lib/ownership/code";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  show: { ok: true as const, showProfileId: "33333333-3333-4333-8333-333333333333" } as
    | { ok: true; showProfileId: string }
    | { ok: false },
  feedUrl: "https://feeds.example.com/show" as string | null,
  proofs: [] as Array<Record<string, unknown>>,
  proofError: null as { code: string; message: string } | null,
  profileError: null as { code: string; message: string } | null,
  payoutError: null as { code: string; message: string } | null,
  heldCount: 0,
  selects: [] as string[],
  browserProfile: { role: "show", plan: "pay_as_you_go" } as { role: string; plan: string } | null,
  browserUser: { id: "11111111-1111-4111-8111-111111111111", email: "show@example.com" } as {
    id: string;
    email: string;
  } | null,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: async () => mocks.show,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      if (table === "payouts") {
        return {
          select(columns: string) {
            mocks.selects.push(`${table}:${columns}`);
            return {
              is() {
                const answer = () => {
                  if (mocks.payoutError) return { data: null, error: mocks.payoutError };
                  const data = Array.from({ length: mocks.heldCount }, (_, index) => ({ id: `held-${index}` }));
                  return { data, error: null };
                };
                return {
                  limit(n: number) {
                    const resolved = answer();
                    if (resolved.data) resolved.data = resolved.data.slice(0, n);
                    return Promise.resolve(resolved);
                  },
                  then(
                    resolve: (value: { data: { id: string }[] | null; error: { code: string; message: string } | null }) => unknown,
                    reject?: (err: unknown) => unknown
                  ) {
                    return Promise.resolve(answer()).then(resolve, reject);
                  },
                };
              },
            };
          },
        };
      }
      return {
        select(columns: string) {
          mocks.selects.push(`${table}:${columns}`);
          const chain = {
            eq() {
              return chain;
            },
            order() {
              const missingColumn =
                mocks.proofError != null &&
                (mocks.proofError.code === "42703" || mocks.proofError.code === "PGRST204");
              if (mocks.proofError && (!missingColumn || columns.includes("decision_note"))) {
                return Promise.resolve({ data: null, error: mocks.proofError });
              }
              const leak = columns.includes("code_hash") || columns.includes("show_id");
              const rows = leak
                ? mocks.proofs.map((row) => ({
                    ...row,
                    code_hash: "leaked-hash",
                    show_id: "99999999-9999-4999-8999-999999999999",
                    name: "Secret Show",
                  }))
                : mocks.proofs;
              return Promise.resolve({ data: rows, error: null });
            },
            maybeSingle() {
              if (table === "show_profiles" && mocks.profileError) {
                return Promise.resolve({ data: null, error: mocks.profileError });
              }
              return Promise.resolve({
                data: table === "show_profiles" ? { feed_url: mocks.feedUrl } : null,
                error: null,
              });
            },
          };
          return chain;
        },
      };
    },
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.browserUser } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: mocks.browserProfile, error: null }),
        }),
      }),
    }),
  }),
}));

import SettingsPage from "../page";
import OwnershipSettingsPage from "./page";
import OwnershipClient, { ownershipView, type OwnershipView } from "./ownership-client";

const CODE = "TAYLSLATE-AB2C34";
const HASH = hashOwnershipCode(CODE);

function view(overrides: Partial<OwnershipView> = {}): OwnershipView {
  return {
    kind: "not_started",
    feedUrl: "https://feeds.example.com/show",
    youtubeAvailable: true,
    target: null,
    medium: null,
    pendingLabel: "Pending",
    verifiedLabel: "Verified",
    ...overrides,
  };
}

describe("ownership settings", () => {
  beforeEach(() => {
    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
    mocks.show = { ok: true, showProfileId: "33333333-3333-4333-8333-333333333333" };
    mocks.feedUrl = "https://feeds.example.com/show";
    mocks.proofs = [];
    mocks.proofError = null;
    mocks.profileError = null;
    mocks.payoutError = null;
    mocks.heldCount = 0;
    mocks.selects = [];
    mocks.browserProfile = { role: "show", plan: "pay_as_you_go" };
    mocks.browserUser = { id: "11111111-1111-4111-8111-111111111111", email: "show@example.com" };
    process.env.YOUTUBE_API_KEY = "test-key";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
  });

  it("redirects a signed-out visitor", async () => {
    mocks.user = null;
    await expect(OwnershipSettingsPage()).rejects.toThrow("REDIRECT:/login?next=/settings/ownership");
  });

  it("does not render for a brand", async () => {
    mocks.show = { ok: false };
    await expect(OwnershipSettingsPage()).rejects.toThrow("NOT_FOUND");
  });

  it("does not render for a show role with no show profile", async () => {
    mocks.show = { ok: false };
    await expect(OwnershipSettingsPage()).rejects.toThrow("NOT_FOUND");
  });

  it("reads proofs without the code hash or a show id", async () => {
    const page = await OwnershipSettingsPage();
    render(page);
    expect(screen.getByRole("heading", { name: "Verify ownership" }).className).toContain("font-app-display");
    expect(screen.getByText("https://feeds.example.com/show")).toBeInTheDocument();
    expect(mocks.selects.join(" ")).toContain("method, status, target, code_expires_at, created_at");
    expect(mocks.selects.join(" ")).not.toContain("code_hash");
    expect(mocks.selects.join(" ")).not.toContain("show_id");
    expect(document.body.textContent).not.toContain("\u2014");
    expect(document.body.textContent).not.toContain(HASH);
  });

  it("shows each state without a code, a hash, or a show name", () => {
    expect(
      ownershipView({
        proofs: [],
        feedUrl: "https://feeds.example.com/show",
        youtubeAvailable: false,
        pendingLabel: "Pending",
        verifiedLabel: "Verified",
      }).kind
    ).toBe("not_started");

    const pending = ownershipView({
      proofs: [
        {
          method: "rss_code",
          status: "pending",
          target: "feeds.example.com/show",
          code_expires_at: "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      feedUrl: "https://feeds.example.com/show",
      youtubeAvailable: true,
      pendingLabel: "Pending",
      verifiedLabel: "Verified",
    });
    expect(pending.kind).toBe("pending");

    const review = ownershipView({
      proofs: [
        {
          method: "youtube_code",
          status: "contested",
          target: "UC1234567890abcdefghij_-",
          code_expires_at: null,
          created_at: "2026-01-02T00:00:00.000Z",
        },
      ],
      feedUrl: null,
      youtubeAvailable: true,
      pendingLabel: "Pending",
      verifiedLabel: "Verified",
    });
    expect(review.kind).toBe("review");

    const verified = ownershipView({
      proofs: [
        {
          method: "rss_code",
          status: "verified",
          target: "feeds.example.com/show",
          code_expires_at: null,
          created_at: "2026-01-03T00:00:00.000Z",
        },
      ],
      feedUrl: "https://feeds.example.com/show",
      youtubeAvailable: true,
      pendingLabel: "Pending",
      verifiedLabel: "Verified",
    });
    expect(verified.kind).toBe("verified");

    const expired = ownershipView({
      proofs: [
        {
          method: "rss_code",
          status: "expired",
          target: "feeds.example.com/show",
          code_expires_at: "2020-01-01T00:00:00.000Z",
          created_at: "2026-01-04T00:00:00.000Z",
        },
      ],
      feedUrl: "https://feeds.example.com/show",
      youtubeAvailable: true,
      pendingLabel: "Pending",
      verifiedLabel: "Verified",
    });
    expect(expired.kind).toBe("expired");

    render(<OwnershipClient view={view({ youtubeAvailable: false })} />);
    expect(screen.getByText("YouTube checks are not available yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    cleanup();

    render(<OwnershipClient view={view({ kind: "pending", target: "feeds.example.com/show", medium: "podcast" })} />);
    expect(screen.getByRole("button", { name: "Check now" })).toBeInTheDocument();
    expect(screen.queryByText(CODE)).not.toBeInTheDocument();
    cleanup();

    render(<OwnershipClient view={view({ kind: "verified", target: "feeds.example.com/show", medium: "podcast" })} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    cleanup();

    render(<OwnershipClient view={view({ kind: "review", target: "UC1234567890abcdefghij_-", medium: "youtube" })} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Our team is reviewing this.")).toBeInTheDocument();
    cleanup();

    render(<OwnershipClient view={view({ kind: "expired" })} />);
    expect(screen.getByText("Start again.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Start again" })).toHaveLength(2);
    expect(document.body.textContent).not.toContain("\u2014");
    expect(document.body.textContent).not.toContain("Secret Show");
    expect(document.body.textContent).not.toContain(HASH);
  });

  it("shows the code only after start, then checks with an empty body", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: CODE,
          message: OWNERSHIP_MESSAGES.paste,
          target: "feeds.example.com/show",
          medium: "podcast",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ outcome: "miss", message: OWNERSHIP_MESSAGES.miss }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnershipClient view={view()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Start" })[0]);
    expect(await screen.findByText(CODE)).toBeInTheDocument();
    expect(screen.getByText(OWNERSHIP_MESSAGES.paste)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(HASH);
    const startBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(startBody).toEqual({ medium: "podcast" });

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText(OWNERSHIP_MESSAGES.miss)).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/ownership/check");
    expect(fetchMock.mock.calls[1][1].body).toBe("{}");
    expect(screen.getByText(CODE)).toBeInTheDocument();
  });

  it("shows an error when the proof read fails", async () => {
    mocks.proofError = { code: "XX000", message: "secret-db-text" };
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    render(await OwnershipSettingsPage());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not load your ownership check. Refresh to try again."
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-db-text");
    expect(logs.join("\n")).toContain("XX000");
    expect(logs.join("\n")).not.toContain("secret-db-text");
  });

  it("shows an error when the profile read fails", async () => {
    mocks.profileError = { code: "XX000", message: "secret-db-text" };
    render(await OwnershipSettingsPage());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not load your ownership check. Refresh to try again."
    );
    expect(screen.queryByText("Add your RSS feed to your show profile first.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-db-text");
  });

  it("adds a Verify ownership card for a show, after Sellable surfaces", async () => {
    const show = render(<SettingsPage />);
    const link = await screen.findByRole("link", { name: /Verify ownership/ });
    expect(link).toHaveAttribute("href", "/settings/ownership");
    const hrefs = [...show.container.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(hrefs.indexOf("/settings/ownership")).toBe(hrefs.indexOf("/settings/show-surfaces") + 1);
    expect(link.textContent).not.toContain("\u2014");

    cleanup();
    mocks.browserProfile = { role: "brand", plan: "pay_as_you_go" };
    const brand = render(<SettingsPage />);
    await screen.findByRole("link", { name: /Brand profile/ });
    expect(brand.container.querySelector('a[href="/settings/ownership"]')).toBeNull();

    cleanup();
    mocks.browserProfile = { role: "agent", plan: "operator" };
    const agent = render(<SettingsPage />);
    await screen.findByRole("link", { name: /Sellable surfaces/ });
    expect(agent.container.querySelector('a[href="/settings/ownership"]')).toBeNull();
  });

  it("renders the O2 view when decision_note is not in the database yet", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    for (const code of ["42703", "PGRST204"]) {
      cleanup();
      mocks.proofError = { code, message: `column decision_note secret ${code}` };
      mocks.proofs = [
        {
          method: "rss_code",
          status: "pending",
          target: "feeds.example.com/show",
          code_expires_at: "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ];
      mocks.selects = [];
      render(await OwnershipSettingsPage());
      expect(screen.getByRole("button", { name: "Check now" })).toBeInTheDocument();
      expect(screen.queryByText("We could not load your ownership check. Refresh to try again.")).not.toBeInTheDocument();
      expect(screen.queryByText("Not verified")).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain("secret");
      expect(document.body.textContent).not.toContain("decision_note");
      const selects = mocks.selects.filter((entry) => entry.startsWith("show_ownership_proofs:"));
      expect(selects[0]).toContain("decision_note");
      expect(selects[1]).toBe(`show_ownership_proofs:${"method, status, target, code_expires_at, created_at"}`);
      expect(logs.join("\n")).toContain(code);
      expect(logs.join("\n")).not.toContain("secret");
    }
  });

  it("reads the decision note and decided time", async () => {
    await OwnershipSettingsPage();
    expect(mocks.selects.join(" ")).toContain("decision_note");
    expect(mocks.selects.join(" ")).toContain("decided_at");
    expect(mocks.selects.join(" ")).not.toContain("code_hash");
  });

  it("shows Not verified with the decision note, and Verified for an admin approval", () => {
    const rejected = ownershipView({
      proofs: [
        {
          method: "admin",
          status: "rejected",
          target: "feeds.example.com/show",
          code_expires_at: null,
          created_at: "2026-02-01T00:00:00.000Z",
          decision_note: "The feed does not match this show.",
          decided_at: "2026-02-02T00:00:00.000Z",
        },
      ],
      feedUrl: "https://feeds.example.com/show",
      youtubeAvailable: true,
      pendingLabel: "Pending",
      verifiedLabel: "Verified",
    });
    expect(rejected.kind).toBe("rejected");
    expect(rejected.decisionNote).toBe("The feed does not match this show.");
    expect(rejected.manual).toBe(true);
    render(<OwnershipClient view={rejected} />);
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText("The feed does not match this show.")).toBeInTheDocument();
    expect(screen.getByText("Start again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask for manual review" })).toBeInTheDocument();
    cleanup();

    const approved = ownershipView({
      proofs: [
        {
          method: "admin",
          status: "verified",
          target: "feeds.example.com/show",
          code_expires_at: null,
          created_at: "2026-02-03T00:00:00.000Z",
        },
      ],
      feedUrl: "https://feeds.example.com/show",
      youtubeAvailable: true,
      pendingLabel: "Pending",
      verifiedLabel: "Verified",
    });
    expect(approved.kind).toBe("verified");
    expect(approved.manual).toBe(false);
    render(<OwnershipClient view={approved} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask for manual review" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("\u2014");
  });

  it("posts a manual review request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: OWNERSHIP_MESSAGES.review }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnershipClient view={view()} />);
    fireEvent.change(screen.getByLabelText("Explanation"), {
      target: { value: "I host this show and can edit the description." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask for manual review" }));
    expect(await screen.findByText(OWNERSHIP_MESSAGES.review)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ownership/manual");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      medium: "podcast",
      explanation: "I host this show and can edit the description.",
    });
  });

  it("shows a payout banner for an unverified owner and hides it when verified", async () => {
    mocks.heldCount = 1;
    render(await OwnershipSettingsPage());
    expect(screen.getByRole("status")).toHaveTextContent(
      "You have a payout waiting. Verify you own your show to receive it."
    );
    expect(document.body.textContent).not.toContain("\u2014");
    cleanup();

    render(<OwnershipClient view={view({ kind: "verified", payoutWaiting: true, target: "feeds.example.com/show" })} />);
    expect(screen.queryByText("You have a payout waiting. Verify you own your show to receive it.")).not.toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("hides the payout banner when the payout read fails and still renders the page", async () => {
    mocks.payoutError = { code: "42501", message: "secret-db-text" };
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    render(await OwnershipSettingsPage());
    expect(screen.getAllByRole("button", { name: "Start" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("You have a payout waiting. Verify you own your show to receive it.")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-db-text");
    expect(logs.join("\n")).toContain("42501");
    expect(logs.join("\n")).not.toContain("secret-db-text");
  });
});
