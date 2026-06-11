// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const { mockPush, mockBack } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockBack: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

import BriefIntakeForm from "./brief-intake-form";
import { nextQuarterLabel } from "./brief-intake-form";

const DERIVATION = {
  brand_name: "SaunaBox",
  category: "premium wellness",
  product_description: "Portable infrared sauna kits.",
  aov_bucket: "high",
  aov_reasoning: "Kits listed at $399-$2,799.",
  key_attributes: ["mobile use case", "premium price point"],
};

function jsonRes(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

/** fetch mock routing the two endpoints the form talks to. */
function stubFetchRoutes(
  overrides: {
    derive?: () => unknown;
    submit?: () => unknown;
  } = {}
) {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    if (url === "/api/campaigns/brief" && body.stage === "draft") {
      return jsonRes({ campaign_id: "camp_1" });
    }
    if (url === "/api/campaigns/brief" && body.stage === "submit") {
      return jsonRes(overrides.submit?.() ?? { campaign_id: "camp_1" });
    }
    if (typeof url === "string" && url.endsWith("/derive-product")) {
      return jsonRes(overrides.derive?.() ?? DERIVATION);
    }
    return jsonRes({ error: "unexpected fetch" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function findCall(fetchMock: ReturnType<typeof vi.fn>, predicate: (url: string, body: Record<string, unknown>) => boolean) {
  return fetchMock.mock.calls.find(([url, init]) => {
    const body = (init as RequestInit)?.body
      ? JSON.parse((init as RequestInit).body as string)
      : {};
    return predicate(url as string, body);
  });
}

function renderForm(
  props: Partial<React.ComponentProps<typeof BriefIntakeForm>> = {}
) {
  return render(
    <BriefIntakeForm
      prefillUrl=""
      initialDraftId={null}
      returning={null}
      {...props}
    />
  );
}

async function deriveViaUrl(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Product URL"), "https://saunabox.com");
  await user.click(screen.getByRole("button", { name: "Read it" }));
  await screen.findByTestId("read-back-card");
}

async function fillCampaignSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Test the channel" }));
  await user.type(screen.getByLabelText("Budget (USD)"), "25000");
  await user.click(screen.getByRole("button", { name: "ASAP" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BriefIntakeForm — first-time brand", () => {
  it("renders all three sections", () => {
    stubFetchRoutes();
    renderForm();
    expect(screen.getByRole("heading", { level: 2, name: /Product/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Customer/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Campaign/ })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "Who buys this? What do they care about? What's worked before?"
      )
    ).toBeInTheDocument();
  });

  it("URL blur triggers draft creation + derive-product call", async () => {
    const fetchMock = stubFetchRoutes();
    renderForm();

    const urlInput = screen.getByLabelText("Product URL");
    fireEvent.change(urlInput, { target: { value: "https://saunabox.com" } });
    fireEvent.blur(urlInput);

    await screen.findByTestId("read-back-card");
    expect(
      findCall(fetchMock, (url, body) => url === "/api/campaigns/brief" && body.stage === "draft")
    ).toBeTruthy();
    const deriveCall = findCall(fetchMock, (url) =>
      url.endsWith("/derive-product")
    );
    expect(deriveCall?.[0]).toBe("/api/campaigns/camp_1/derive-product");
    expect(JSON.parse((deriveCall?.[1] as RequestInit).body as string)).toEqual({
      url: "https://saunabox.com",
    });
  });

  it("read-back card renders the derived fields", async () => {
    stubFetchRoutes();
    const user = userEvent.setup();
    renderForm();
    await deriveViaUrl(user);

    expect(screen.getByLabelText("Brand name")).toHaveValue("SaunaBox");
    expect(screen.getByLabelText("Category")).toHaveValue("premium wellness");
    expect(screen.getByLabelText("Product description")).toHaveValue(
      "Portable infrared sauna kits."
    );
    expect(screen.getByLabelText("Average order value")).toHaveValue("high");
    expect(screen.getByLabelText("Key attributes (comma-separated)")).toHaveValue(
      "mobile use case, premium price point"
    );
    expect(screen.getByText("Kits listed at $399-$2,799.")).toBeInTheDocument();
  });

  it("brand edits to the read-back card are included in the submit payload", async () => {
    const fetchMock = stubFetchRoutes();
    const user = userEvent.setup();
    renderForm();
    await deriveViaUrl(user);

    const brandInput = screen.getByLabelText("Brand name");
    await user.clear(brandInput);
    await user.type(brandInput, "SaunaBox Pro");

    await user.type(
      screen.getByPlaceholderText(/Who buys this/),
      "Affluent men 30-55 into recovery."
    );
    await fillCampaignSection(user);
    await user.click(screen.getByRole("button", { name: /See how I/ }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const submit = findCall(
      fetchMock,
      (url, body) => url === "/api/campaigns/brief" && body.stage === "submit"
    );
    const body = JSON.parse((submit?.[1] as RequestInit).body as string);
    expect(body.product.brand_name).toBe("SaunaBox Pro");
    expect(body.product.source).toBe("url");
    expect(body.customer_text).toBe("Affluent men 30-55 into recovery.");
  });

  it("goals multi-select enforces the 3-item cap", async () => {
    stubFetchRoutes();
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Test the channel" }));
    await user.click(screen.getByRole("button", { name: "Scale a winner" }));
    await user.click(screen.getByRole("button", { name: "Direct response" }));

    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Brand awareness" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Lead gen" })).toBeDisabled();
  });

  it("submit posts the full brief and redirects to the interpretation page", async () => {
    const fetchMock = stubFetchRoutes();
    const user = userEvent.setup();
    renderForm();
    await deriveViaUrl(user);

    await user.type(
      screen.getByPlaceholderText(/Who buys this/),
      "Affluent men 30-55 into recovery."
    );
    await fillCampaignSection(user);
    await user.click(screen.getByRole("button", { name: /See how I/ }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/campaigns/camp_1/interpretation")
    );
    const submit = findCall(
      fetchMock,
      (url, body) => url === "/api/campaigns/brief" && body.stage === "submit"
    );
    const body = JSON.parse((submit?.[1] as RequestInit).body as string);
    expect(body.campaign_id).toBe("camp_1");
    expect(body.goals).toEqual(["test_channel"]);
    expect(body.budget_total).toBe(25000);
    expect(body.flight).toEqual({ mode: "preset", preset: "asap" });
  });

  it("url_unreachable switches to the paste-a-paragraph fallback", async () => {
    stubFetchRoutes({
      derive: () => ({ error: "url_unreachable", fallback_required: true }),
    });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Product URL"), "https://broken.example");
    await user.click(screen.getByRole("button", { name: "Read it" }));

    expect(
      await screen.findByLabelText(/describe the product instead/)
    ).toBeInTheDocument();
  });

  it("validation blocks submit until the brief is complete", async () => {
    stubFetchRoutes();
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /See how I/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/product URL/i);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("BriefIntakeForm — returning-brand check-in", () => {
  const RETURNING = {
    patternId: "pat_1",
    previousSummary: "affluent recovery-focused men 30-55",
  };

  it("first-time brand sees the full form, not the check-in", () => {
    stubFetchRoutes();
    renderForm({ returning: null });
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Product URL")).toBeInTheDocument();
  });

  it("brand with a prior campaign pattern sees the check-in", () => {
    stubFetchRoutes();
    renderForm({ returning: RETURNING });
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument();
    expect(
      screen.getByText("affluent recovery-focused men 30-55")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Product URL")).not.toBeInTheDocument();
  });

  it("'Nothing has changed' routes to campaign decisions and submits with the reused pattern", async () => {
    const fetchMock = stubFetchRoutes();
    const user = userEvent.setup();
    renderForm({ returning: RETURNING });

    await user.click(screen.getByRole("button", { name: /Nothing has changed/ }));

    expect(screen.queryByLabelText("Product URL")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Who buys this/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Campaign/ })).toBeInTheDocument();

    await fillCampaignSection(user);
    await user.click(screen.getByRole("button", { name: /See how I/ }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const submit = findCall(
      fetchMock,
      (url, body) => url === "/api/campaigns/brief" && body.stage === "submit"
    );
    const body = JSON.parse((submit?.[1] as RequestInit).body as string);
    expect(body.customer_context).toEqual({ reused_from_pattern_id: "pat_1" });
    expect(body.product).toBeUndefined();
    expect(body.customer_text).toBeUndefined();
  });

  it("free-text delta is carried into customer_context.delta_text", async () => {
    const fetchMock = stubFetchRoutes();
    const user = userEvent.setup();
    renderForm({ returning: RETURNING });

    await user.type(
      screen.getByPlaceholderText(/New product line/),
      "Launched a $99 entry SKU"
    );
    await user.click(
      screen.getByRole("button", { name: /Continue with this update/ })
    );

    await fillCampaignSection(user);
    await user.click(screen.getByRole("button", { name: /See how I/ }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const submit = findCall(
      fetchMock,
      (url, body) => url === "/api/campaigns/brief" && body.stage === "submit"
    );
    const body = JSON.parse((submit?.[1] as RequestInit).body as string);
    expect(body.customer_context).toEqual({
      reused_from_pattern_id: "pat_1",
      delta_text: "Launched a $99 entry SKU",
    });
  });

  it("'treat this as a new brief' escape hatch drops to the full intake", async () => {
    stubFetchRoutes();
    const user = userEvent.setup();
    renderForm({ returning: RETURNING });

    await user.click(
      screen.getByRole("button", { name: /treat this as a new brief/ })
    );

    expect(screen.getByLabelText("Product URL")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Who buys this/)
    ).toBeInTheDocument();
  });
});

describe("nextQuarterLabel", () => {
  it("labels the quarter after the current one, rolling the year at Q4", () => {
    expect(nextQuarterLabel(new Date("2026-06-10"))).toBe("Q3 2026");
    expect(nextQuarterLabel(new Date("2026-11-15"))).toBe("Q1 2027");
  });
});
