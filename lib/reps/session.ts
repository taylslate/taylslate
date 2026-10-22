// Session gate for rep reads. The agent id is auth.getUser().
// Body, query, and headers are not consulted.

import { createClient } from "@/lib/supabase/server";
import { getUserProfile } from "@/lib/data/queries";

export type AgentGate =
  | { ok: true; agentId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAgent(): Promise<AgentGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== "agent") {
    return { ok: false, status: 403, error: "Only agents can read this." };
  }

  return { ok: true, agentId: user.id };
}
