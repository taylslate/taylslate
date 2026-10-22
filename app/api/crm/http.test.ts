import { afterEach, describe, expect, it, vi } from "vitest";
import { crmFailure } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("crmFailure", () => {
  it("maps PostgREST PGRST116 to 404 Not found", async () => {
    const res = crmFailure({
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("maps the single-row message thrown by the CRM store", async () => {
    const res = crmFailure(new Error("JSON object requested, multiple (or no) rows returned"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("leaves other errors unchanged", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const missing = crmFailure(new Error("contact not found"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Contact not found." });

    const note = crmFailure(new Error("note not found"));
    expect(note.status).toBe(404);
    expect(await note.json()).toEqual({ error: "Note not found." });

    const signedOut = crmFailure(new Error("not signed in"));
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: "Sign in required." });

    const invalid = crmFailure(new Error("name is required"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Name is required." });

    const failed = crmFailure(new Error("connection reset"));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "CRM request failed." });
  });
});
