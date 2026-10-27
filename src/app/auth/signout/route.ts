import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = new URL(request.url).searchParams.get("reason");
  const target = reason === "not_on_team" ? "/login?error=not_on_team" : "/login?signed_out=1";
  return NextResponse.redirect(new URL(target, request.url), { status: 303 });
}

export const GET = signOut;
export const POST = signOut;
