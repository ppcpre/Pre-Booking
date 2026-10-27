import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Best effort: an audit failure must never block the user's action. */
export async function audit(actorId: string, action: string, entity: string, entityId: string, after?: unknown, before?: unknown) {
  try {
    const supabase = await createClient();
    await supabase.from("audit_logs").insert({ actor_id: actorId, action, entity, entity_id: entityId, after: after ?? null, before: before ?? null });
  } catch {
    // ignore
  }
}
