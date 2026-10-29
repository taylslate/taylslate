import { describe, expect, it } from "vitest";
import {
  ADMIN_TEST_AGENT_USER_ID,
  ADMIN_VIEW_AGENT,
  TEST_ACCOUNTS,
  adminViewAccountFromCookie,
  adminViewCookieValue,
  configuredAdminViewAccount,
} from "./test-accounts";

const TEST_AGENT = {
  key: "agent1",
  label: "Test Agent 1",
  userId: "e0592378-1981-4f44-98a1-db67fee0ea79",
  email: "chris+agent@taylslate.com",
  role: "agent" as const,
};

describe("configuredAdminViewAccount", () => {
  it("returns Chris's test agent account", () => {
    expect(ADMIN_TEST_AGENT_USER_ID).toBe(TEST_AGENT.userId);
    expect(ADMIN_VIEW_AGENT).toEqual(TEST_AGENT);
    expect(configuredAdminViewAccount("agent")).toEqual(TEST_AGENT);
  });

  it("keeps brand and show on their test accounts", () => {
    expect(configuredAdminViewAccount("brand")).toMatchObject({
      key: "brand1",
      label: "Test Brand 1",
      role: "brand",
    });
    expect(configuredAdminViewAccount("show")).toMatchObject({
      key: "show1",
      label: "Test Show 1",
      role: "show",
    });
  });

  it("keeps the agent off the test-login list", () => {
    expect(TEST_ACCOUNTS.map((account) => account.key)).toEqual(["brand1", "show1"]);
  });

  it("resolves the agent view cookie to that account", () => {
    const account = configuredAdminViewAccount("agent");
    expect(account).not.toBeNull();
    expect(adminViewCookieValue(account!)).toBe("test:agent1");
    expect(adminViewAccountFromCookie("test:agent1")).toEqual(account);
  });
});
