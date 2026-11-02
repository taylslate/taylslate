import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitMp3 } from "./audio";

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

  it("does not write the audio to a temp file", () => {
    const src = readFileSync(join(process.cwd(), "lib/airchecks/audio.ts"), "utf8");
    expect(src).not.toMatch(/mkdtemp|writeFile|tmpdir/);
    const whisper = readFileSync(join(process.cwd(), "lib/airchecks/openai-whisper.ts"), "utf8");
    expect(whisper).not.toMatch(/new Uint8Array\(audio\.bytes\)/);
  });
});
