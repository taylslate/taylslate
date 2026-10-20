import { afterEach, describe, expect, it } from "vitest";
import { canViewDesignPreview } from "./access";

const original = process.env.INTERNAL_ADMIN_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.INTERNAL_ADMIN_EMAILS;
  else process.env.INTERNAL_ADMIN_EMAILS = original;
});

describe("canViewDesignPreview", () => {
  it("allows only internal admin emails", () => {
    process.env.INTERNAL_ADMIN_EMAILS = "founder@example.com, ops@example.com";
    expect(canViewDesignPreview("founder@example.com")).toBe(true);
    expect(canViewDesignPreview("OPS@example.com")).toBe(true);
    expect(canViewDesignPreview("brand@example.com")).toBe(false);
    expect(canViewDesignPreview(null)).toBe(false);
  });
});
