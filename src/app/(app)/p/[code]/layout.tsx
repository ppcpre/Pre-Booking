import Link from "next/link";
import { PropertyThumb } from "@/components/property-thumb";
import { requireMember, canManageProperties } from "@/lib/session";
import { getProperty } from "@/lib/properties";
import { signedPhotoUrls } from "@/lib/photos";
import { PROPERTY_TYPE_LABEL } from "@/lib/types";
import { PropertyTabs } from "./property-tabs";

export default async function PropertyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ code: string }> }) {
  const { code } = await params;
  const member = await requireMember();
  const p = await getProperty(code);
  const urls = await signedPhotoUrls([p.photo_path]);
  const canBook = member.role !== "ACCOUNTANT" && p.status === "ACTIVE";
  return (
    <div className="page">
      <div>
        <div className="crumb"><Link href="/">All properties</Link> / {p.name}</div>
        <div className="head">
          <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
            <PropertyThumb name={p.name} url={p.photo_path ? urls[p.photo_path] : null} size="lg" />
            <div style={{ minWidth: 0 }}>
              <h1>{p.name}</h1>
              <p>{PROPERTY_TYPE_LABEL[p.type]} · check-in {p.check_in_time.slice(0, 5)} · check-out {p.check_out_time.slice(0, 5)}{p.status === "DRAFT" ? " · draft" : ""}</p>
            </div>
          </div>
          <div className="actions">
            {canManageProperties(member.role) && <Link className="btn" href={`/settings/properties/${p.code}/details`}>Settings</Link>}
            {canBook && <Link className="btn primary" href={`/p/${p.code}/bookings/new`}>New booking</Link>}
          </div>
        </div>
      </div>
      <PropertyTabs code={p.code} />
      {children}
    </div>
  );
}
