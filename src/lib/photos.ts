import "server-only";
import { createClient } from "@/lib/supabase/server";

export const PHOTO_BUCKET = "property-photos";

/** Signed URLs (1 hour) for property photos, keyed by storage path. */
export async function signedPhotoUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (list.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(list, 3600);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}
