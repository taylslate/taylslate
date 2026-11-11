// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
  }) => <img src={src} alt={alt} width={width} height={height} />,
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

import PrivacyPage from "./page";

const CONSENT_LINE =
  "Taylslate may use aggregated, anonymized data from deals booked and completed through Taylslate to improve pricing and recommendations. Aggregates never identify a brand, and each one combines at least five brands. Files you upload stay private unless you choose to share them.";

describe("Privacy Policy page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the draft banner, the approved consent line, and the placeholders", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Draft for review. Not yet legal advice or an agreed contract.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(CONSENT_LINE)).toBeInTheDocument();
    expect(document.body.textContent).toContain("[COMPANY LEGAL NAME]");
    expect(document.body.textContent).toContain("[MAILING ADDRESS]");
    expect(document.body.textContent).toContain("[PRIVACY CONTACT EMAIL]");
    expect(document.body.textContent).toContain("[CONFIRM WITH COUNSEL]");
    expect(document.body.textContent).toContain("pooling-v1");
    expect(document.body.textContent).toContain("Supabase");
    expect(document.body.textContent).toContain("YouTube Data API");
    expect(document.body.textContent).not.toContain("\u2014");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("discloses Google and YouTube data, retention, and Limited Use", () => {
    render(<PrivacyPage />);

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Google and YouTube data",
    });
    const google = heading.closest("section")?.textContent ?? "";

    expect(google).toContain(
      "Taylslate's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
    );
    expect(google).toContain("30 days");
    expect(google).toContain("7 days");
    expect(google).not.toContain("\u2014");

    for (const href of [
      "https://www.youtube.com/t/terms",
      "https://policies.google.com/privacy",
      "https://security.google.com/settings/security/permissions",
      "https://developers.google.com/terms/api-services-user-data-policy",
    ]) {
      expect(screen.getByRole("link", { name: href })).toHaveAttribute(
        "href",
        href,
      );
    }

    expect(document.body.textContent).toContain(
      "Google (YouTube Data API and YouTube Analytics API): public channel data, and, for creators who connect a channel, the data described under Google and YouTube data.",
    );
    expect(document.body.textContent).toContain(
      "Connecting a YouTube channel sets a short-lived cookie (10 minutes) that protects the Google sign-in step.",
    );
    expect(document.body.textContent).toContain(
      "You can also disconnect YouTube as described under Google and YouTube data.",
    );
    expect(document.body.textContent).toContain("[PRIVACY CONTACT EMAIL]");
  });
});
