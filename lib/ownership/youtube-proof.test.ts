import { beforeEach, describe, expect, it, vi } from "vitest";

const getClient = vi.fn();
const getChannelDetails = vi.fn();

vi.mock("@/lib/enrichment/youtube", () => ({
  getYouTubeClientSafe: () => getClient(),
}));

import { readYoutubeDescription } from "./youtube-proof";

const UC = "UC1234567890abcdefghij_-";

describe("youtube ownership description", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChannelDetails.mockReset();
  });

  it("is unavailable when there is no client", async () => {
    getClient.mockReturnValue(null);
    expect(await readYoutubeDescription(UC)).toEqual({ status: "unavailable" });
    expect(getChannelDetails).not.toHaveBeenCalled();
  });

  it("is unavailable when the call fails and does not log the error body", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    getClient.mockReturnValue({ getChannelDetails });
    getChannelDetails.mockRejectedValue(new Error("quota key=SECRET body"));
    expect(await readYoutubeDescription(UC)).toEqual({ status: "unavailable" });
    expect(logs.join("\n")).not.toContain("SECRET");
  });

  it("returns snippet.description from getChannelDetails", async () => {
    getClient.mockReturnValue({ getChannelDetails });
    getChannelDetails.mockResolvedValue({
      description: "Hello taylslate-ab2c34 there",
      title: "Hidden Show",
    });
    expect(await readYoutubeDescription(UC)).toEqual({
      status: "ok",
      description: "Hello taylslate-ab2c34 there",
    });
    expect(getChannelDetails).toHaveBeenCalledWith(UC);

    getChannelDetails.mockResolvedValue(null);
    expect(await readYoutubeDescription(UC)).toEqual({ status: "ok", description: "" });
  });
});
