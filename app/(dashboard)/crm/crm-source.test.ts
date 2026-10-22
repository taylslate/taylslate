import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CRM_EMAIL_MAX,
  CRM_NAME_MAX,
  CRM_NOTE_MAX,
  CRM_PHONE_MAX,
  CRM_ROLE_MAX,
} from "@/lib/crm/store";
import {
  CRM_EMAIL_MAX as UI_EMAIL_MAX,
  CRM_NAME_MAX as UI_NAME_MAX,
  CRM_NOTE_MAX as UI_NOTE_MAX,
  CRM_PHONE_MAX as UI_PHONE_MAX,
  CRM_ROLE_MAX as UI_ROLE_MAX,
} from "./components/limits";

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const MOCKUP_PATH = ["admin", "mockups"].join("/");

describe("CRM source guards", () => {
  it("does not import the admin mockup screens", async () => {
    const files = [
      ...(await sourceFiles("app/(dashboard)/crm")),
      ...(await sourceFiles("app/api/crm")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toContain(MOCKUP_PATH);
      expect(text, file).not.toContain("\u2014");
    }
  });

  it("keeps client limits aligned with the store", () => {
    expect(UI_NAME_MAX).toBe(CRM_NAME_MAX);
    expect(UI_EMAIL_MAX).toBe(CRM_EMAIL_MAX);
    expect(UI_ROLE_MAX).toBe(CRM_ROLE_MAX);
    expect(UI_PHONE_MAX).toBe(CRM_PHONE_MAX);
    expect(UI_NOTE_MAX).toBe(CRM_NOTE_MAX);
  });
});
