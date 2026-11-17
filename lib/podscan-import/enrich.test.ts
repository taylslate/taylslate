import { describe, expect, it } from "vitest";
import { enrichShow, listenerFromDetail } from "./enrich";

function missing(): Error {
  return Object.assign(new Error("missing"), { status: 404 });
}

describe("enrich", () => {
  it("skips the detail call when search already has listener data", async () => {
    const paths: string[] = [];
    const listener = { total_listeners: 4 };
    const result = await enrichShow("pd_1", listener, async (path) => {
      paths.push(path);
      if (path.endsWith("/demographics")) return { bands: { a: 1 } };
      throw missing();
    });
    expect(paths).toEqual(["/podcasts/pd_1/demographics"]);
    expect(result.demographics).toEqual({ bands: { a: 1 } });
    expect(result.listener).toBe(listener);
  });

  it("treats a 404 as empty and reads listener_engagement from the detail body", async () => {
    const paths: string[] = [];
    const result = await enrichShow("pd_2", null, async (path) => {
      paths.push(path);
      if (path.endsWith("/demographics")) throw missing();
      return { podcast: { listener_engagement: { total_listeners: 9 } } };
    });
    expect(paths).toEqual(["/podcasts/pd_2/demographics", "/podcasts/pd_2"]);
    expect(result.demographics).toBeNull();
    expect(result.listener).toEqual({ total_listeners: 9 });
    expect(listenerFromDetail({ listener_engagement: { total_listeners: 1 } })).toEqual({
      total_listeners: 1,
    });
  });

  it("rethrows a non-404 error", async () => {
    await expect(
      enrichShow("pd_3", null, async () => {
        throw Object.assign(new Error("down"), { status: 500 });
      })
    ).rejects.toMatchObject({ status: 500 });
  });
});
