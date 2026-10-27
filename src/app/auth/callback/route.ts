import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  // Supabase sends the "Before User Created" hook rejection back as an error here.
  const authError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (authError) return to(/team/i.test(authError) ? "/login?error=not_on_team" : "/login?error=callback");

  const code = url.searchParams.get("code");
  if (!code) return to("/login?error=callback");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return to("/login?error=callback");

  await supabase.rpc("link_team_member");
  // An existing account may have been deactivated since it was created.
  const { data: user } = await supabase.auth.getUser();
  const { data: member } = await supabase
    .from("team_members")
    .select("is_active")
    .eq("user_id", user.user?.id ?? "")
    .maybeSingle();
  if (!member?.is_active) {
    await supabase.auth.signOut();
    return to("/login?error=not_on_team");
  }
  await supabase.rpc("touch_sign_in");
  return to(next);
}
