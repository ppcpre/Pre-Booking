"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/session";
import { audit } from "@/lib/audit";
import { businessSchema, firstError, formToObject } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";

export async function saveBusiness(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireRole("ADMIN");
  const parsed = businessSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("business_settings").update(parsed.data).eq("id", true);
  if (error) return { error: "Couldn't save. Try again." };
  await audit(me.userId, "business.update", "business_settings", "1", parsed.data);
  revalidatePath("/settings/business");
  return { ok: true, message: "Saved" };
}
