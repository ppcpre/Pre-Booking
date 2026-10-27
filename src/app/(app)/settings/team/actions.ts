"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/session";
import { audit } from "@/lib/audit";
import { emailSchema, firstError, roleSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";

const addSchema = z.object({ email: emailSchema, role: roleSchema, property_ids: z.array(z.string().uuid()) });

export async function addMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireRole("ADMIN");
  const parsed = addSchema.safeParse({ email: fd.get("email"), role: fd.get("role"), property_ids: fd.getAll("property_ids") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { email, role, property_ids } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("team_members").insert({ email, role, added_by: me.userId });
  if (error) return { error: error.code === "23505" ? `${email} is already on the team` : "Couldn't add this member. Try again." };
  if (role !== "ADMIN" && property_ids.length) {
    await supabase.from("property_staff").insert(property_ids.map((property_id) => ({ property_id, email })));
  }
  await audit(me.userId, "team.add", "team_member", email, { role, property_ids });
  revalidatePath("/settings/team");
  return { ok: true, message: `Added ${email}. They can sign in with Google now.` };
}

/** Refuses changes that would leave the team without an active admin. */
async function keepsAnAdmin(email: string, nextRole: string, nextActive: boolean) {
  const supabase = await createClient();
  const { data } = await supabase.from("team_members").select("email").eq("role", "ADMIN").eq("is_active", true);
  const remaining = (data ?? []).filter((r) => r.email !== email).length + (nextRole === "ADMIN" && nextActive ? 1 : 0);
  return remaining > 0;
}

export async function changeRole(fd: FormData) {
  const me = await requireRole("ADMIN");
  const email = emailSchema.parse(fd.get("email"));
  const role = roleSchema.parse(fd.get("role"));
  if (!(await keepsAnAdmin(email, role, true))) return;
  const supabase = await createClient();
  await supabase.from("team_members").update({ role }).eq("email", email);
  await audit(me.userId, "team.role", "team_member", email, { role });
  revalidatePath("/settings/team");
}

export async function setActive(fd: FormData) {
  const me = await requireRole("ADMIN");
  const email = emailSchema.parse(fd.get("email"));
  const active = fd.get("active") === "true";
  if (!active && email === me.email) return; // can't lock yourself out
  const supabase = await createClient();
  const { data: row } = await supabase.from("team_members").select("role").eq("email", email).single();
  if (!active && row && !(await keepsAnAdmin(email, row.role, false))) return;
  await supabase.from("team_members").update({ is_active: active }).eq("email", email);
  await audit(me.userId, active ? "team.reactivate" : "team.deactivate", "team_member", email);
  revalidatePath("/settings/team");
}
