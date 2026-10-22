import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  cursorFilter,
  decodeCursor,
  encodeCursor,
  parseCursor,
  parseLimit,
} from "./pagination";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("api v1 pagination", () => {
  it("round trips an opaque base64url cursor", () => {
    const cursor = { created_at: "2026-03-04T05:06:07.000Z", id: ID };
    const token = encodeCursor(cursor);
    expect(token).not.toContain(ID);
    expect(token).not.toMatch(/[+/=]/);
    expect(decodeCursor(token)).toEqual(cursor);
    expect(parseCursor(token)).toEqual({ ok: true, cursor });
    expect(parseCursor(null)).toEqual({ ok: true, cursor: null });
    expect(parseCursor("%%%").ok).toBe(false);
  });

  it("keeps a stored timestamp and rejects a non-uuid id", () => {
    const offset = "2026-03-04T05:06:07.123456+00:00";
    expect(decodeCursor(encodeCursor({ created_at: offset, id: ID }))).toEqual({
      created_at: offset,
      id: ID,
    });
    expect(
      decodeCursor(encodeCursor({ created_at: "2026-03-04T05:06:07Z", id: ID }))
    ).toEqual({ created_at: "2026-03-04T05:06:07Z", id: ID });

    const evil = Buffer.from(
      JSON.stringify({
        created_at: "2026-01-01T00:00:00.000Z",
        id: "not-a-uuid",
      }),
      "utf8"
    ).toString("base64url");
    expect(decodeCursor(evil)).toBeNull();
  });

  it("defaults limit to 25 and clamps above 100", () => {
    expect(parseLimit(null)).toEqual({ ok: true, limit: 25 });
    expect(parseLimit("")).toEqual({ ok: true, limit: 25 });
    expect(parseLimit(" 10 ")).toEqual({ ok: true, limit: 10 });
    expect(parseLimit("100")).toEqual({ ok: true, limit: 100 });
    expect(parseLimit("101")).toEqual({ ok: true, limit: 100 });
    expect(parseLimit("5000")).toEqual({ ok: true, limit: 100 });
    expect(parseLimit("0")).toEqual({ ok: false });
    expect(parseLimit("-1")).toEqual({ ok: false });
    expect(parseLimit("abc")).toEqual({ ok: false });
    expect(parseLimit("1.5")).toEqual({ ok: false });
  });

  it("quotes timestamps inside the cursor filter", () => {
    const filter = cursorFilter({
      created_at: "2026-03-04T05:06:07.000Z",
      id: ID,
    });
    expect(filter).toBe(
      `created_at.lt."2026-03-04T05:06:07.000Z",and(created_at.eq."2026-03-04T05:06:07.000Z",id.lt.${ID})`
    );
  });
});
