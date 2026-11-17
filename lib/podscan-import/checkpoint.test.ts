import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isStale, readCheckpoint, writeJsonAtomic, writeTextAtomic } from "./checkpoint";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "podscan-checkpoint-"));
  dirs.push(dir);
  return dir;
}

describe("checkpoint", () => {
  it("writes atomically and keeps the previous file when rename does not run", async () => {
    const dir = await tempDir();
    const file = join(dir, "checkpoint.json");
    await writeJsonAtomic(file, { version: 1, probe: { pd_1: "ep_1" } });
    const mode = await stat(file);
    expect(mode.mode & 0o777).toBe(0o600);
    await expect(
      writeJsonAtomic(file, { version: 1, probe: { pd_1: "changed" } }, {
        beforeRename() {
          throw new Error("boom");
        },
      })
    ).rejects.toThrow("boom");
    const text = await readFile(file, "utf8");
    expect(text).toContain("ep_1");
    expect(text).not.toContain("changed");
    const read = await readCheckpoint(file);
    expect(read.probe?.pd_1).toBe("ep_1");
  });

  it("returns an empty checkpoint for a missing or bad file", async () => {
    const dir = await tempDir();
    expect((await readCheckpoint(join(dir, "missing.json"))).version).toBe(1);
    const bad = join(dir, "bad.json");
    await writeTextAtomic(bad, "not json");
    expect((await readCheckpoint(bad)).search).toBeUndefined();
    await writeFile(bad, JSON.stringify({ version: 2 }), "utf8");
    expect((await readCheckpoint(bad)).version).toBe(1);
    expect((await readCheckpoint(bad)).probe).toBeUndefined();
  });

  it("treats candidate data older than 7 days as stale", () => {
    const now = Date.parse("2026-11-17T00:00:00.000Z");
    expect(isStale("2026-11-16T00:00:00.000Z", now)).toBe(false);
    expect(isStale("2026-11-09T00:00:00.000Z", now)).toBe(true);
    expect(isStale(undefined, now)).toBe(true);
  });
});
