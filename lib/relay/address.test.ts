import { afterEach, describe, expect, it } from "vitest";
import { parseRelayAddress, randomRelayToken, relayAddress, relayReplyTo } from "./address";

const TOKEN = "abcdefghijklmnopqrstuvwxyz";

describe("relay address", () => {
  afterEach(() => {
    delete process.env.RELAY_INBOUND_ENABLED;
  });

  it("builds 26-character tokens from the base32 alphabet", () => {
    const token = randomRelayToken();
    expect(token).toMatch(/^[a-z2-7]{26}$/);
    expect(relayAddress(token)).toBe(`r-${token}@reply.taylslate.com`);
  });

  it("makes 1000 unique tokens that do not contain an outreach id", () => {
    const outreachId = "11111111-1111-4111-8111-111111111111";
    const tokens = new Set<string>();
    for (let n = 0; n < 1000; n += 1) tokens.add(randomRelayToken());
    expect(tokens.size).toBe(1000);
    const first = randomRelayToken();
    const second = randomRelayToken();
    expect(first).not.toBe(second);
    expect(first).not.toContain(outreachId.replace(/-/g, "").slice(0, 8));
  });

  it("parses only the relay address and normalizes case", () => {
    expect(parseRelayAddress(`r-${TOKEN}@reply.taylslate.com`)).toBe(TOKEN);
    expect(parseRelayAddress(`R-${TOKEN.toUpperCase()}@REPLY.TAYLSLATE.COM`)).toBe(TOKEN);
    expect(parseRelayAddress(`Brand <r-${TOKEN}@reply.taylslate.com>`)).toBe(TOKEN);
    expect(parseRelayAddress(`r-${TOKEN}@outreach.taylslate.com`)).toBeNull();
    expect(parseRelayAddress(`r-${TOKEN}@reply.taylslate.com, other@example.test`)).toBeNull();
    expect(parseRelayAddress(`extra+r-${TOKEN}@reply.taylslate.com`)).toBeNull();
    expect(parseRelayAddress(`r-${TOKEN.slice(0, 25)}@reply.taylslate.com`)).toBeNull();
    expect(parseRelayAddress(`r-${TOKEN}1@reply.taylslate.com`)).toBeNull();
  });

  it("keeps today's reply address until the inbound flag is exactly true", () => {
    expect(relayReplyTo({ address_token: TOKEN })).toBe("outreach@taylslate.com");
    process.env.RELAY_INBOUND_ENABLED = "false";
    expect(relayReplyTo({ address_token: TOKEN })).toBe("outreach@taylslate.com");
    process.env.RELAY_INBOUND_ENABLED = "true";
    expect(relayReplyTo({ address_token: TOKEN })).toBe(`r-${TOKEN}@reply.taylslate.com`);
    expect(relayReplyTo(null)).toBe("outreach@taylslate.com");
  });
});
