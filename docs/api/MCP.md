# MCP endpoint

`POST /api/v1/mcp` exposes the public API v1 reads and the two pending-action writes as MCP tools. It does not add a new business action. A tool either reads what `/api/v1` already returns or records a pending `api_write_actions` row.

The transport is stateless Streamable HTTP. Send one JSON-RPC 2.0 object per POST. The response is `Content-Type: application/json` and `Cache-Control: no-store`. A notification (no `id`) returns `202` with an empty body. A JSON array is HTTP `400` and JSON-RPC `-32600`. There is no SSE response and no session.

Supported protocol versions: `2026-07-28` (current), `2025-11-25`, and `2025-06-18`.

## Connect a client

Point the client at `https://www.taylslate.com/api/v1/mcp` and send the brand API key as a bearer token. The key is the same `ts_live_<prefix>_<secret>` value created for `/api/v1`. It is shown once at creation and is stored only as a hash.

```http
POST /api/v1/mcp HTTP/1.1
Host: www.taylslate.com
Authorization: Bearer ts_live_<prefix>_<secret>
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: server/discover
```

A browser client must send an `Origin` whose host matches the request host. A server-side client can omit `Origin`. A different host is HTTP `403`.

On `2026-07-28`, every POST also sends `MCP-Protocol-Version` and `Mcp-Method`. `tools/call` also sends `Mcp-Name` with the tool name. The same version is repeated in `params._meta["io.modelcontextprotocol/protocolVersion"]`. A mismatch is HTTP `400` and JSON-RPC `-32020`.

On `2025-11-25` or `2025-06-18`, call `initialize` first, then send `MCP-Protocol-Version` on later requests. This server does not mint a session id. `Mcp-Session-Id` is ignored.

## Tools

`tools/list` returns the tools the key's scopes include, in this order.

| Tool | Scope | Arguments |
| --- | --- | --- |
| `list_shows` | `read` | `cursor`, `limit` |
| `get_show` | `read` | `id` |
| `list_campaigns` | `read` | `cursor`, `limit` |
| `get_campaign` | `read` | `id` |
| `list_campaign_scores` | `read` | `id` (campaign), `cursor`, `limit` |
| `get_campaign_plan` | `read` | `id` (campaign) |
| `list_deals` | `read` | `cursor`, `limit` |
| `get_deal` | `read` | `id` |
| `list_actions` | `read` | `cursor`, `limit` |
| `get_action` | `read` | `id` |
| `propose_campaign` | `write:campaigns` | v1 campaign body plus `idempotency_key` |
| `propose_outreach` | `write:outreach` | v1 outreach body plus `idempotency_key` |

`limit` defaults to 25 and clamps at 100. Lists use the same cursor as `/api/v1`. Unknown argument names are rejected. `brand_id`, `user_id`, and `key_id` are unknown names. The brand is the key's brand.

`propose_campaign` and `propose_outreach` only record a pending action the brand approves in Taylslate. Nothing is sent, created, or charged. `idempotency_key` is 1 to 128 printable ASCII characters. The same key and payload returns `{ action_id, status, replayed: true }`. The same key with a different payload is a tool error with status `409`.

A show on `propose_outreach` must be discoverable, or owned by this brand through a deal. Otherwise the tool result is not found and no row is written.

Show reads match `GET /api/v1/shows`. Contact and rates are included only when this brand is tied to the show.

## Example: tools/list

Request:

```http
POST /api/v1/mcp HTTP/1.1
Authorization: Bearer ts_live_<prefix>_<secret>
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/list

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28"
    }
  }
}
```

Response (read scope only, names only):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resultType": "complete",
    "tools": [
      { "name": "list_shows", "title": "List shows" },
      { "name": "get_show", "title": "Get show" },
      { "name": "list_campaigns", "title": "List campaigns" },
      { "name": "get_campaign", "title": "Get campaign" },
      { "name": "list_campaign_scores", "title": "List campaign scores" },
      { "name": "get_campaign_plan", "title": "Get campaign plan" },
      { "name": "list_deals", "title": "List deals" },
      { "name": "get_deal", "title": "Get deal" },
      { "name": "list_actions", "title": "List actions" },
      { "name": "get_action", "title": "Get action" }
    ]
  }
}
```

Each tool object also includes `description` and `inputSchema`.

## Example: tools/call

Request:

```http
POST /api/v1/mcp HTTP/1.1
Authorization: Bearer ts_live_<prefix>_<secret>
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_campaign

{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_campaign",
    "arguments": { "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28"
    }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "resultType": "complete",
    "content": [
      {
        "type": "text",
        "text": "{\"data\":{\"id\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1\",\"name\":\"Spring test\",\"status\":\"draft\",\"budget_total\":25000,\"platforms\":[\"podcast\"],\"brief\":{\"version\":2,\"product\":null,\"customer_text\":\"Buyers\",\"goals\":[\"test_channel\"],\"goals_context\":null,\"flight\":null,\"exclusions_text\":null,\"submitted_at\":null},\"test_spot_count\":null,\"test_placement\":null,\"created_at\":\"2026-03-01T00:00:00.000Z\",\"updated_at\":\"2026-03-01T00:00:00.000Z\"}}"
      }
    ],
    "structuredContent": {
      "data": {
        "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        "name": "Spring test",
        "status": "draft",
        "budget_total": 25000,
        "platforms": ["podcast"],
        "brief": {
          "version": 2,
          "product": null,
          "customer_text": "Buyers",
          "goals": ["test_channel"],
          "goals_context": null,
          "flight": null,
          "exclusions_text": null,
          "submitted_at": null
        },
        "test_spot_count": null,
        "test_placement": null,
        "created_at": "2026-03-01T00:00:00.000Z",
        "updated_at": "2026-03-01T00:00:00.000Z"
      }
    },
    "isError": false
  }
}
```

The `text` value is `JSON.stringify` of `structuredContent`. Fields match the v1 campaign serializer. Another brand's id is `isError: true` with `structuredContent.status` `404` and message `Not found.`

A pending campaign looks like this:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"action_id\":\"cccccccc-cccc-4ccc-8ccc-ccccccccccc9\",\"status\":\"pending\",\"replayed\":false}"
    }
  ],
  "structuredContent": {
    "action_id": "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
    "status": "pending",
    "replayed": false
  },
  "isError": false
}
```

## Errors

| Situation | HTTP | Body |
| --- | --- | --- |
| Missing, malformed, revoked, or untied key | 401 | `{ "error": "<ApiAuthError message>" }` and `WWW-Authenticate: Bearer` |
| Brand plan does not include API access | 403 | `{ "error": "Your plan does not include API access.", "code": "plan_no_api_access" }` |
| `Origin` host is not the request host | 403 | JSON-RPC `-32600`, no `id` |
| Over 60 requests for this key in the UTC minute | 429 | `{ "error": "Rate limit exceeded." }` and `Retry-After` |
| Body over 64 KB | 413 | `{ "error": "Request body is too large." }` |
| Body is not JSON | 415 | `{ "error": "Request body must be JSON." }` |
| `GET`, `PUT`, `PATCH`, `DELETE` | 405 | `Allow: POST` |
| JSON array (batch) | 400 | JSON-RPC `-32600` |
| Unsupported protocol version | 400 | JSON-RPC `-32022`, `data.supported` lists the three versions |
| Header does not match the body | 400 | JSON-RPC `-32020` |
| Unknown method | 404 | JSON-RPC `-32601` |
| Bad params, including an unknown tool name | 400 | JSON-RPC `-32602` |
| Notification accepted | 202 | Empty body |
| Tool lacked scope, was not found, conflicted, or failed validation | 200 | Tool result with `isError: true`. `structuredContent` is `{ "error", "status" }` (`403`, `404`, `409`, `422`, or `400`) |
| Unexpected failure | 500 | JSON-RPC `-32603`, message `MCP request failed.` |

Tool errors do not include a stack, a SQL message, a key, a prefix, or a hash. Logs are one line: method, tool name, outcome code, elapsed milliseconds. Arguments, outreach text, and the `Authorization` value are not logged.

`resolveApiRequest` writes the existing `api_call` row. This endpoint does not write a second metering row.

## In process

`callTool` in `lib/mcp/tools.ts` runs the same tool without HTTP. Pass `{ brandId, keyId, scopes }` and the arguments object. A command agent caller passes `keyId: null` and `source: "command_agent"`. `recordAction` then stores `api_key_id` null, `source` `command_agent`, and `requested_by` equal to `brandId`. That insert needs migration 083, which is not applied. An API key caller leaves `source` unset and still stores `api_key_id`. The caller cannot set `source` through tool arguments. CA1 is the in-process caller. Its user-facing name is Tay.
