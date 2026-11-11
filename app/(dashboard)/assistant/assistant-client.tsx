"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { tokens } from "@/lib/brand/tokens";

interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: Record<string, unknown>;
  action_ids: string[];
  created_at: string;
}

const EMPTY =
  "Ask Tay for a campaign plan, a show lookup, or an outreach draft. Anything that changes your account waits for your approval.";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtnClass =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";

export default function AssistantClient() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const response = await fetch("/api/assistant");
    const body = (await response.json()) as { conversations?: Conversation[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Could not load conversations.");
    return Array.isArray(body.conversations) ? body.conversations : [];
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const response = await fetch(`/api/assistant/${id}`);
    const body = (await response.json()) as { messages?: AgentMessage[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Could not load the conversation.");
    return Array.isArray(body.messages) ? body.messages : [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await loadList();
        if (cancelled) return;
        setConversations(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load conversations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  async function openConversation(id: string) {
    setActiveId(id);
    setError(null);
    setLoading(true);
    try {
      setMessages(await loadThread(id));
    } catch (err) {
      setMessages([]);
      setError(err instanceof Error ? err.message : "Could not load the conversation.");
    } finally {
      setLoading(false);
    }
  }

  async function startConversation() {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as { conversation?: Conversation; error?: string };
      if (!response.ok || !body.conversation) {
        throw new Error(body.error || "Could not start a conversation.");
      }
      setConversations((current) => [body.conversation as Conversation, ...current]);
      setActiveId(body.conversation.id);
      setMessages([]);
      return body.conversation.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a conversation.");
      return null;
    } finally {
      setSending(false);
    }
  }

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      let id = activeId;
      if (!id) {
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const created = (await response.json()) as { conversation?: Conversation; error?: string };
        if (!response.ok || !created.conversation) {
          throw new Error(created.error || "Could not start a conversation.");
        }
        id = created.conversation.id;
        setConversations((current) => [created.conversation as Conversation, ...current]);
        setActiveId(id);
      }
      const response = await fetch(`/api/assistant/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = (await response.json()) as { messages?: AgentMessage[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Tay could not answer.");
      const next = Array.isArray(body.messages) ? body.messages : [];
      setMessages((current) => mergeMessages(current, next));
      setDraft("");
      setConversations((current) =>
        current.map((row) => (row.id === id && !row.title ? { ...row, title: message.slice(0, 80) } : row))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tay could not answer.");
    } finally {
      setSending(false);
    }
  }

  async function removeConversation(id: string) {
    setError(null);
    const response = await fetch(`/api/assistant/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error || "Could not delete the conversation.");
      return;
    }
    setConversations((current) => current.filter((row) => row.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  }

  return (
    <div className="max-w-3xl p-4 sm:p-8">
      <p className={kickerClass}>For brands</p>
      <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>Tay</h1>
      <p className={`mb-6 mt-1 ${mutedText}`}>
        Tay can look things up and propose the next step. You approve anything that changes your account.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={ghostBtnClass}
          style={radiusStyle}
          disabled={sending}
          onClick={() => void startConversation()}
        >
          New conversation
        </button>
        {activeId ? (
          <button
            type="button"
            className={ghostBtnClass}
            style={radiusStyle}
            disabled={sending}
            onClick={() => void removeConversation(activeId)}
          >
            Delete
          </button>
        ) : null}
      </div>

      {conversations.length > 0 ? (
        <ul className="mb-4 flex flex-wrap gap-2">
          {conversations.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={row.id === activeId ? inkBtnClass : ghostBtnClass}
                style={radiusStyle}
                onClick={() => void openConversation(row.id)}
              >
                {row.title || "New conversation"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className={`mb-4 ${mutedText}`} role="alert">
          {error}
        </p>
      ) : null}

      <div className={`${panelClass} mb-4`} style={radiusStyle}>
        {loading && messages.length === 0 ? (
          <Loading label="Loading." />
        ) : messages.length === 0 ? (
          <p className={mutedText}>{EMPTY}</p>
        ) : (
          <ul className="space-y-4">
            {messages.map((message) => (
              <li key={message.id}>
                <p className={kickerClass}>{roleLabel(message.role)}</p>
                <p className={`mt-1 whitespace-pre-wrap ${inkText}`}>{messageText(message)}</p>
                {message.role === "assistant" && message.action_ids.length > 0 ? (
                  <p className={`mt-2 ${mutedText}`}>
                    Waiting for your approval.{" "}
                    <Link href="/settings/agent-actions" className="text-[var(--ts-accent-text)]">
                      Review actions
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {sending ? <Loading label="Tay is working." /> : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className={mutedText} htmlFor="tay-message">
          Message
        </label>
        <textarea
          id="tay-message"
          className={`mt-1 ${fieldClass}`}
          style={radiusStyle}
          rows={4}
          maxLength={4000}
          value={draft}
          placeholder="Plan a 25k test on true crime podcasts next quarter"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className={`mt-3 ${inkBtnClass}`}
          style={radiusStyle}
          disabled={sending || draft.trim().length === 0}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="mt-4 flex items-center gap-3" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--ts-ink-on-paper)]/20 border-t-[var(--ts-ink-on-paper)]" />
      <p className={mutedText}>{label}</p>
    </div>
  );
}

function roleLabel(role: AgentMessage["role"]): string {
  if (role === "user") return "You";
  if (role === "tool") return "Lookup";
  return "Tay";
}

const TOOL_LINES: Record<string, string> = {
  list_shows: "Looked up shows",
  get_show: "Looked up a show",
  list_campaigns: "Looked up campaigns",
  get_campaign: "Looked up a campaign",
  list_campaign_scores: "Looked up scores",
  get_campaign_plan: "Looked up a plan",
  list_deals: "Looked up deals",
  get_deal: "Looked up a deal",
  list_actions: "Looked up actions",
  get_action: "Looked up an action",
  propose_campaign: "Proposed a campaign",
  propose_outreach: "Proposed an outreach draft",
};

function messageText(message: AgentMessage): string {
  if (message.role === "tool") {
    if (message.content.status === "error") return "Could not finish that lookup.";
    const name = typeof message.content.name === "string" ? message.content.name : "";
    return TOOL_LINES[name] ?? "Looked something up";
  }
  return typeof message.content.text === "string" ? message.content.text : "";
}

function mergeMessages(current: AgentMessage[], next: AgentMessage[]): AgentMessage[] {
  const seen = new Set(current.map((row) => row.id));
  const merged = [...current];
  for (const row of next) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}
