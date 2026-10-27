import { Shell } from "@/components/shell";
import { requireMember } from "@/lib/session";
import { listProperties } from "@/lib/properties";
import { signedPhotoUrls } from "@/lib/photos";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const properties = (await listProperties()).filter((p) => p.status !== "ARCHIVED");
  const urls = await signedPhotoUrls(properties.map((p) => p.photo_path));
  return (
    <Shell
      member={{ name: member.name, email: member.email, role: member.role, avatarUrl: member.avatarUrl }}
      properties={properties.map((p) => ({
        code: p.code,
        name: p.name,
        status: p.status,
        units: p.unit_count,
        photoUrl: p.photo_path ? urls[p.photo_path] ?? null : null,
      }))}
    >
      {children}
    </Shell>
  );
}
