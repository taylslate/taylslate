import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  linkResolvesToChannel,
  parseChannelRef,
  parseYoutubeSeedCsv,
  readYoutubeSeedCsv,
} from "./seeds";

describe("youtube seed csv", () => {
  it("ships a header and no channel rows", () => {
    const text = readFileSync(join(process.cwd(), "data", "youtube-seeds.csv"), "utf8");
    expect(text.trim()).toBe("channel_url,channel_id");
    expect(parseYoutubeSeedCsv(text)).toEqual([]);
    expect(readYoutubeSeedCsv()).toEqual([]);
  });

  it("queues channel_id when set, otherwise the url, and drops duplicates", () => {
    const text = [
      "channel_url,channel_id",
      "https://www.youtube.com/@HubermanLab,",
      ",UCabcdefghijklmnopqrstuv",
      "https://www.youtube.com/@HubermanLab,",
      "",
    ].join("\n");
    expect(parseYoutubeSeedCsv(text)).toEqual([
      "https://www.youtube.com/@HubermanLab",
      "UCabcdefghijklmnopqrstuv",
    ]);
  });
});

describe("channel ref resolution", () => {
  const id = "UCabcdefghijklmnopqrstuv";

  it("reads a channel id, a handle, and a user url", () => {
    expect(parseChannelRef(id)).toEqual({ kind: "id", value: id });
    expect(parseChannelRef(`https://www.youtube.com/channel/${id}`)).toEqual({ kind: "id", value: id });
    expect(parseChannelRef("https://www.youtube.com/@HubermanLab?si=1")).toEqual({
      kind: "handle",
      value: "HubermanLab",
    });
    expect(parseChannelRef("@HubermanLab")).toEqual({ kind: "handle", value: "HubermanLab" });
    expect(parseChannelRef("https://www.youtube.com/user/hubermanlab")).toEqual({
      kind: "username",
      value: "hubermanlab",
    });
    expect(parseChannelRef("https://youtu.be/abcdefghijk")).toBeNull();
    expect(parseChannelRef("not a channel")).toBeNull();
  });

  it("resolves a stored link only on that channel id or handle", () => {
    expect(linkResolvesToChannel(`https://www.youtube.com/channel/${id}`, id)).toBe(true);
    expect(linkResolvesToChannel("https://www.youtube.com/@HubermanLab", id, "@HubermanLab")).toBe(true);
    expect(linkResolvesToChannel("https://www.youtube.com/@Other", id, "@HubermanLab")).toBe(false);
    expect(linkResolvesToChannel("https://www.youtube.com/@HubermanLab", id)).toBe(false);
    expect(linkResolvesToChannel(`https://www.youtube.com/channel/${id}`, "UCzzzzzzzzzzzzzzzzzzzzzz")).toBe(
      false
    );
  });
});
