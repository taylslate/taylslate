import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { parseMediaKitGeography, hasAudienceGeography } from "@/lib/shows/media-kit-geo";
import { extractKitText } from "@/lib/shows/media-kit-text";

const MEDIA_KIT_MAX = 20_000;
const MAX_BYTES = 2_000_000;

/**
 * Preview a pasted or uploaded media kit. Does not save. The onboarding
 * form stores the text through PUT /api/show-profile, which parses again.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let text = "";
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "File is too large" }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      text = extractKitText(buf);
    } else {
      const body = (await request.json()) as { text?: unknown };
      text = typeof body.text === "string" ? body.text : "";
    }
  } catch {
    return NextResponse.json({ error: "Could not read that file" }, { status: 400 });
  }

  text = text.trim().slice(0, MEDIA_KIT_MAX);
  const geography = parseMediaKitGeography(text);
  return NextResponse.json({
    text,
    geography: hasAudienceGeography(geography) ? geography : null,
  });
}
