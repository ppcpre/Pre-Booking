import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export type Member = {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
};

/** The signed-in team member, or null when signed out, not on the team, or deactivated. */
export const getMember = cache(async (): Promise<Member | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("team_members")
    .select("email, full_name, role, is_active")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  const meta = auth.user.user_metadata ?? {};
  return {
    userId: auth.user.id,
    email: data.email,
    name: data.full_name || meta.full_name || meta.name || data.email,
    avatarUrl: meta.avatar_url ?? null,
    role: data.role as Role,
  };
});

export async function requireMember(): Promise<Member> {
  const m = await getMember();
  if (!m) redirect("/auth/signout?reason=not_on_team");
  return m;
}

export async function requireRole(...roles: Role[]): Promise<Member> {
  const m = await requireMember();
  if (!roles.includes(m.role)) redirect("/?denied=1");
  return m;
}

export function canManageProperties(role: Role) {
  return role === "ADMIN" || role === "MANAGER";
}
