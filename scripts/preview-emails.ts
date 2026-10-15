// Render every Taylslate email to docs/email-previews/<id>.html.
// Run: npx tsx scripts/preview-emails.ts

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderEmailPreviews } from "../lib/email/preview";

const dir = path.join(process.cwd(), "docs", "email-previews");
mkdirSync(dir, { recursive: true });

const previews = renderEmailPreviews();
const ids = new Set<string>();
for (const preview of previews) {
  if (ids.has(preview.id)) {
    throw new Error(`Duplicate preview id: ${preview.id}`);
  }
  ids.add(preview.id);
  writeFileSync(path.join(dir, `${preview.id}.html`), preview.html);
  console.log(`${preview.id}.html`);
}
console.log(`${previews.length} previews`);
