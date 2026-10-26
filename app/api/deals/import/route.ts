import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { IO_EXTRACTION_SYSTEM_PROMPT, IO_EXTRACTION_USER_PROMPT } from "@/lib/prompts/io-extraction";
import { validateIOData, buildPartialIO } from "@/lib/validation/io-validation";
import { createLLMClient } from "@/lib/llm/client";
import { getAuthenticatedUser, getUserProfile } from "@/lib/data/queries";
import {
  detectPastCampaignKind,
  parsePastCampaignFile,
  PastCampaignImportError,
} from "@/lib/imports/past-campaigns";
import { enforceUpload } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await enforceUpload(request, null);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";

  // --- PDF Upload Path ---
  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const pastCampaignMode =
      formData.get("mode") === "past_campaign" ||
      new URL(request.url).searchParams.get("mode") === "past_campaign";
    if (pastCampaignMode) {
      return handlePastCampaignImport(formData);
    }

    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 10MB" }, { status: 400 });
    }

    // Read file and base64 encode
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");

    // Instantiate Anthropic client — SDK reads ANTHROPIC_API_KEY from env automatically
    let client: Anthropic;
    try {
      client = new Anthropic();
    } catch {
      return NextResponse.json(
        {
          error: "PDF extraction is not configured. Please add an ANTHROPIC_API_KEY environment variable, or use manual entry instead.",
          code: "NO_API_KEY",
        },
        { status: 503 }
      );
    }

    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: IO_EXTRACTION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: IO_EXTRACTION_USER_PROMPT,
              },
            ],
          },
        ],
      });

      // Extract text response
      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return NextResponse.json(
          { error: "No text response from extraction" },
          { status: 500 }
        );
      }

      // Parse JSON response
      let extractedData: Record<string, unknown>;
      try {
        extractedData = JSON.parse(textBlock.text);
      } catch {
        return NextResponse.json(
          { error: "Failed to parse extraction results. The PDF may not contain a recognizable IO." },
          { status: 422 }
        );
      }

      // Validate and normalize
      const validation = validateIOData(extractedData);
      const ioData = buildPartialIO(extractedData);

      return NextResponse.json({
        io: ioData,
        validation,
        source: "pdf",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `Extraction failed: ${message}` },
        { status: 500 }
      );
    }
  }

  // --- Manual Entry Path ---
  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const validation = validateIOData(body);
    const ioData = buildPartialIO(body);

    return NextResponse.json({
      io: ioData,
      validation,
      source: "manual",
    });
  }

  return NextResponse.json(
    { error: "Unsupported content type" },
    { status: 415 }
  );
}

async function handlePastCampaignImport(formData: FormData) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await getUserProfile(user.id);
  if (!profile || (profile.role !== "brand" && profile.role !== "agency")) {
    return NextResponse.json(
      { error: "Only brand and agency accounts can import past campaigns" },
      { status: 403 }
    );
  }

  const file = uploadedFile(formData.get("file"));
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  try {
    const kind = detectPastCampaignKind(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const drafts = await parsePastCampaignFile(kind, bytes, {
      extractIo: extractIoPdf,
    });
    return NextResponse.json({
      source: "past_campaign",
      source_kind: kind,
      file_name: file.name,
      drafts,
    });
  } catch (err) {
    if (err instanceof PastCampaignImportError) {
      return NextResponse.json(
        err.code ? { error: err.message, code: err.code } : { error: err.message },
        { status: err.status }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Extraction failed: ${message}` },
      { status: 500 }
    );
  }
}

function uploadedFile(value: FormDataEntryValue | null): File | null {
  if (!value || typeof value === "string") return null;
  if (typeof value.arrayBuffer !== "function" || typeof value.name !== "string") {
    return null;
  }
  return value;
}

// createLLMClient() owns the SDK constructor. The model stays the IO PDF
// model above, passed explicitly so this path does not follow LLM_MODEL.
async function extractIoPdf(bytes: Uint8Array): Promise<Record<string, unknown>> {
  let client: ReturnType<typeof createLLMClient>;
  try {
    client = createLLMClient();
  } catch {
    throw new PastCampaignImportError(
      "PDF extraction is not configured. Add an ANTHROPIC_API_KEY environment variable, or use manual entry instead.",
      503,
      "NO_API_KEY"
    );
  }

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: IO_EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: Buffer.from(bytes).toString("base64"),
            },
          },
          {
            type: "text",
            text: IO_EXTRACTION_USER_PROMPT,
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new PastCampaignImportError("No text response from extraction", 500);
  }

  try {
    return JSON.parse(textBlock.text) as Record<string, unknown>;
  } catch {
    throw new PastCampaignImportError(
      "Failed to parse extraction results. The PDF may not contain a recognizable IO.",
      422
    );
  }
}
