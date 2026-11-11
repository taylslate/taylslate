import { describe, expect, it } from "vitest";
import { redactOutreach, redactOutreaches } from "./public";

describe("redactOutreach", () => {
  it("clears token and leaves every other field", () => {
    const row = {
      id: "o1",
      token: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      show_name: "Daily Briefing",
      proposed_cpm: 25,
    };
    const redacted = redactOutreach(row);
    expect(redacted.token).toBe("");
    expect(redacted.id).toBe("o1");
    expect(redacted.show_name).toBe("Daily Briefing");
    expect(redacted.proposed_cpm).toBe(25);
    expect(row.token).toBe("eyJhbGciOiJIUzI1NiJ9.payload.sig");
  });

  it("clears the token on every row", () => {
    const rows = redactOutreaches([
      { id: "o1", token: "a.b.c", show_name: "A" },
      { id: "o2", token: "d.e.f", show_name: "B" },
    ]);
    expect(rows.map((row) => row.token)).toEqual(["", ""]);
    expect(rows.map((row) => row.id)).toEqual(["o1", "o2"]);
    expect(rows.map((row) => row.show_name)).toEqual(["A", "B"]);
  });
});
