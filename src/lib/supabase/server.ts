import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, assertEnv } from "@/lib/env";

/** Supabase client for Server Components, Server Actions and Route Handlers. Runs as the signed-in user (RLS applies). */
export async function createClient() {
  assertEnv();
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. Middleware refreshes the session instead.
        }
      },
    },
  });
}
