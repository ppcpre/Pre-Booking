import Link from "next/link";
import { PropertyThumb } from "@/components/property-thumb";
import { requireMember, canManageProperties } from "@/lib/session";
import { getProperty, getRatePlans, getRoomTypes, getSetupStatus, getUnits } from "@/lib/properties";
import { signedPhotoUrls } from "@/lib/photos";
import { activationBlockers } from "@/lib/setup";
import { formatTHB } from "@/lib/money";
import { PROPERTY_TYPE_LABEL } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: (await params).code };
}

export default async function PropertyHome({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const member = await requireMember();
  const p = await getProperty(code);
  const [roomTypes, units, status, urls] = await Promise.all([
    getRoomTypes(p.id),
    getUnits(p.id),
    getSetupStatus(p.id),
    signedPhotoUrls([p.photo_path]),
  ]);
  const rates = await getRatePlans(roomTypes.map((r) => r.id));
  const blockers = activationBlockers(status);
  const canManage = canManageProperties(member.role);

  return (
    <div className="page">
      <div>
        <div className="crumb"><Link href="/">All properties</Link> / {p.name}</div>
        <div className="head">
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <PropertyThumb name={p.name} url={p.photo_path ? urls[p.photo_path] : null} size="lg" />
            <div>
              <h1>{p.name}</h1>
              <p>{PROPERTY_TYPE_LABEL[p.type]} · {units.length} units · check-in {p.check_in_time.slice(0, 5)} · check-out {p.check_out_time.slice(0, 5)}</p>
            </div>
          </div>
          {canManage && <div className="actions"><Link className="btn" href={`/settings/properties/${p.code}/details`}>Property settings</Link></div>}
        </div>
      </div>

      {p.status === "DRAFT" && (
        <div className="card" style={{ background: "var(--amber-bg)", borderColor: "var(--amber-bg)" }}>
          <h2>This property is a draft <span>not open for bookings yet</span></h2>
          {blockers.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          ) : (
            <p style={{ margin: 0 }}>Everything is set. Open it from the last setup step.</p>
          )}
          {canManage && <div><Link className="btn primary" href={`/settings/properties/${p.code}/${blockers.length ? "details" : "staff"}`}>Continue setup</Link></div>}
        </div>
      )}

      <div className="split wide">
        <div className="block">
          <h2>Units <span>{units.length}</span></h2>
          {units.length === 0 ? (
            <div className="empty"><b>No units yet</b>{canManage && <Link className="btn" href={`/settings/properties/${p.code}/units`}>Add units</Link>}</div>
          ) : (
            <div className="panel tw">
              <table className="t">
                <thead><tr><th>Unit</th><th>Floor</th><th>Room type</th><th>Rented as</th><th>Status</th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td className="unit">{u.code}</td>
                      <td>{u.floor ?? <span className="dim">–</span>}</td>
                      <td>{roomTypes.find((r) => r.id === u.room_type_id)?.name}</td>
                      <td style={{ display: "flex", gap: 4 }}>
                        {u.allowed_modes.includes("DAILY") && <span className="tag">Daily</span>}
                        {u.allowed_modes.includes("YEARLY") && <span className="tag y">Yearly</span>}
                      </td>
                      <td><span className={`st ${u.status === "ACTIVE" ? "ok" : u.status === "MAINTENANCE" ? "warn" : "idle"}`}>{u.status === "ACTIVE" ? "Active" : u.status === "MAINTENANCE" ? "Maintenance" : "Inactive"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="block">
          <h2>Rates</h2>
          <div className="card">
            {roomTypes.length === 0 && <span className="dim">No room types yet.</span>}
            {roomTypes.map((rt) => {
              const d = rates.find((r) => r.room_type_id === rt.id && r.mode === "DAILY");
              const y = rates.find((r) => r.room_type_id === rt.id && r.mode === "YEARLY");
              return (
                <div key={rt.id} style={{ display: "grid", gap: 2 }}>
                  <b style={{ fontWeight: 500 }}>{rt.name}</b>
                  <span className="hint">
                    {d ? `Daily ${formatTHB(d.base_amount)}/night${d.weekend_amount ? ` · Fri–Sat ${formatTHB(d.weekend_amount)}` : ""}` : "Daily: not set"}
                    {" · "}
                    {y ? `Yearly ${formatTHB(y.base_amount)}/month` : "Yearly: not set"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="hint">Today&apos;s arrivals, the calendar and payments for this property arrive in the next sprint.</p>
        </div>
      </div>
    </div>
  );
}
