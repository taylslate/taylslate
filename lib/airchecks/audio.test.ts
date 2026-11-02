import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { splitMp3, withEpisodeFile } from "./audio";

function mp3Frame(): Uint8Array {
  const frame = new Uint8Array(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0xc4;
  return frame;
}

describe("episode audio", () => {
  it("splits an mp3 on frame boundaries under the whisper limit", () => {
    const bytes = new Uint8Array(417 * 2);
    bytes.set(mp3Frame(), 0);
    bytes.set(mp3Frame(), 417);
    const chunks = splitMp3(bytes, 417);
    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(2);
    expect(chunks?.every((chunk) => chunk.byteLength <= 417)).toBe(true);
  });

  it("deletes the audio file after the work finishes", async () => {
    let seen = "";
    await withEpisodeFile(new Uint8Array([1, 2, 3]), "episode.mp3", async (filePath) => {
      seen = filePath;
      await access(filePath);
    });
    await expect(access(seen)).rejects.toThrow();
  });
});
