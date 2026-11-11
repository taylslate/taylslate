import { describe, expect, it } from "vitest";
import { parseIsoDuration, pickCaptionTrack, segmentsToTranscript, vttToSegments } from "./captions";

describe("caption tracks and VTT", () => {
  it("prefers a standard track in the video language, then asr", () => {
    const tracks = [
      { id: "asr-en", language: "en", trackKind: "asr" },
      { id: "std-es", language: "es", trackKind: "standard" },
      { id: "std-en", language: "en-US", trackKind: "standard" },
    ];
    expect(pickCaptionTrack(tracks, "en")?.id).toBe("std-en");
    expect(pickCaptionTrack(tracks.filter((track) => track.id !== "std-en"), "en")?.id).toBe("asr-en");
    expect(pickCaptionTrack([{ id: "forced", language: "en", trackKind: "forced" }], "en")).toBeNull();
    expect(pickCaptionTrack(tracks, null)?.id).toBe("std-es");
  });

  it("strips tags and collapses rolling duplicate lines", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<c>hello</c>

00:00:01.500 --> 00:00:03.500
hello world

00:00:02.000 --> 00:00:04.000
hello world today

00:01:00.000 --> 00:01:02.000
a later line
`;
    const segments = vttToSegments(vtt);
    expect(segments).toEqual([
      { start_seconds: 1, end_seconds: 4, text: "hello world today" },
      { start_seconds: 60, end_seconds: 62, text: "a later line" },
    ]);
    expect(segmentsToTranscript(segments)).toBe("hello world today a later line");
  });

  it("parses ISO durations", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("P1D")).toBeNull();
  });
});
