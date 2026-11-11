import { describe, expect, it } from "vitest";
import {
  BODY_MAX_BYTES,
  CALL_MAX_RETRIES,
  CALL_TIMEOUT_MS,
  COMMAND_AGENT_DAY_BUCKET,
  COMMAND_AGENT_DAY_MAX,
  COMMAND_AGENT_HOUR_BUCKET,
  COMMAND_AGENT_HOUR_MAX,
  DAILY_CAP_MESSAGE,
  DAILY_TOKEN_CAP,
  HISTORY_LIMIT,
  MAX_MODEL_CALLS,
  MAX_OUTPUT_TOKENS,
  MAX_TOOL_CALLS,
  MESSAGE_MAX_CHARS,
  TURN_DEADLINE_MS,
  commandAgentRules,
  parseCreateBody,
  parseMessageBody,
  readLimitedJson,
  utcDayStart,
} from "@/lib/command-agent/limits";

describe("command agent limits", () => {
  it("uses the default hour, day, token, and turn caps", () => {
    expect(commandAgentRules("user-1")).toEqual([
      {
        bucket: COMMAND_AGENT_HOUR_BUCKET,
        key: "user-1",
        max: COMMAND_AGENT_HOUR_MAX,
        windowSeconds: 60 * 60,
      },
      {
        bucket: COMMAND_AGENT_DAY_BUCKET,
        key: "user-1",
        max: COMMAND_AGENT_DAY_MAX,
        windowSeconds: 24 * 60 * 60,
      },
    ]);
    expect(COMMAND_AGENT_HOUR_MAX).toBe(20);
    expect(COMMAND_AGENT_DAY_MAX).toBe(60);
    expect(DAILY_TOKEN_CAP).toBe(300_000);
    expect(MAX_MODEL_CALLS).toBe(6);
    expect(MAX_TOOL_CALLS).toBe(8);
    expect(MAX_OUTPUT_TOKENS).toBe(1500);
    expect(CALL_TIMEOUT_MS).toBe(25_000);
    expect(CALL_MAX_RETRIES).toBe(1);
    expect(TURN_DEADLINE_MS).toBe(90_000);
    expect(HISTORY_LIMIT).toBe(20);
    expect(BODY_MAX_BYTES).toBe(16 * 1024);
    expect(MESSAGE_MAX_CHARS).toBe(4000);
    expect(DAILY_CAP_MESSAGE).toBe("Daily assistant limit reached. Try again tomorrow.");
  });

  it("starts the token day at 00:00 UTC", () => {
    expect(utcDayStart(new Date("2026-11-10T23:15:00.000Z"))).toBe("2026-11-10T00:00:00.000Z");
  });

  it("rejects unknown keys and a message outside 1 to 4000 printable characters", () => {
    expect(parseCreateBody({ title: "Plan", extra: true })).toEqual({
      ok: false,
      error: "Unknown field extra.",
    });
    expect(parseCreateBody({})).toEqual({ ok: true, title: null });
    expect(parseMessageBody({ message: "  hello  " })).toEqual({ ok: true, message: "hello" });
    expect(parseMessageBody({ message: "" }).ok).toBe(false);
    expect(parseMessageBody({ message: "a".repeat(4001) }).ok).toBe(false);
    expect(parseMessageBody({ message: "bad\u0000text" }).ok).toBe(false);
    expect(parseMessageBody({ message: "hi", brand_id: "x" })).toEqual({
      ok: false,
      error: "Unknown field brand_id.",
    });
  });

  it("caps the JSON body at 16 KB and requires an object", async () => {
    const large = await readLimitedJson(
      new Request("http://localhost/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "a".repeat(20_000) }),
      })
    );
    expect(large.ok).toBe(false);
    if (!large.ok) expect(large.status).toBe(413);
    const text = await readLimitedJson(
      new Request("http://localhost/api/assistant", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      })
    );
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.status).toBe(415);
    const array = await readLimitedJson(
      new Request("http://localhost/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      })
    );
    expect(array.ok).toBe(false);
    if (!array.ok) expect(array.status).toBe(422);
  });
});
