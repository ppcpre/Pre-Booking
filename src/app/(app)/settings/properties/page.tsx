import Link from "next/link";
import { PropertyThumb } from "@/components/property-thumb";
import { requireRole } from "@/lib/session";
import { listProperties } from "@/lib/properties";
import { signedPhotoUrls } from "@/lib/photos";
import { PROPERTY_TYPE_LABEL } from "@/lib/types";

export const metadata = { title: "Properties" };

const STATUS = { DRAFT: ["warn", "Draft"], ACTIVE: ["ok", "Open"], ARCHIVED: ["idle", "Archived"] } as const;

export default async function PropertiesPage() {
  await requireRole("ADMIN", "MANAGER");
  const props = await listProperties();
  const urls = await signedPhotoUrls(props.map((p) => p.photo_path));
  return (
    <div className="page">
      <div className="head">
        <div><h1>Properties</h1><p>Rooms, units, rates and meters for each property.</p></div>
        <div className="actions"><Link className="btn primary" href="/settings/properties/new">Add property</Link></div>
      </div>
      {props.length === 0 ? (
        <div className="empty">
          <b>No properties yet</b>
          <span>Add your first property. It stays a draft until rooms, units and rates are set.</span>
          <Link className="btn primary" href="/settings/properties/new">Add property</Link>
        </div>
      ) : (
        <div className="panel tw">
          <table className="t">
            <thead><tr><th>Property</th><th>Code</th><th>Type</th><th className="r">Units</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {props.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/settings/properties/${p.code}/details`} style={{ display: "flex", gap: 10, alignItems: "center", textDecoration: "none" }}>
                      <PropertyThumb name={p.name} url={p.photo_path ? urls[p.photo_path] : null} size="md" />
                      <b style={{ fontWeight: 500 }}>{p.name}</b>
                    </Link>
                  </td>
                  <td className="code">{p.code}</td>
                  <td>{PROPERTY_TYPE_LABEL[p.type]}</td>
                  <td className="r">{p.unit_count}</td>
                  <td><span className={`st ${STATUS[p.status][0]}`}>{STATUS[p.status][1]}</span></td>
                  <td className="r"><Link className="btn sm" href={`/settings/properties/${p.code}/details`}>{p.status === "DRAFT" ? "Continue setup" : "Edit"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
