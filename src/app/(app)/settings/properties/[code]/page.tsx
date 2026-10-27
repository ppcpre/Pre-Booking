import { redirect } from "next/navigation";

export default async function PropertySettingsIndex({ params }: { params: Promise<{ code: string }> }) {
  redirect(`/settings/properties/${(await params).code}/details`);
}
