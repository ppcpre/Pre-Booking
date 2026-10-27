import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static files, PWA files and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|sw.js|swe-worker|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
