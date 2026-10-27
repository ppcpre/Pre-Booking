import { ActionForm } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { getProperty, getSetupStatus } from "@/lib/properties";
import { activationBlockers } from "@/lib/setup";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { activateProperty, saveStaff } from "../actions";

export async function StaffStep({ propertyCode }: { propertyCode: string }) {
  const p = await getProperty(propertyCode);
  const supabase = await createClient();
  const [{ data: members }, { data: staff }, status] = await Promise.all([
    supabase.from("team_members").select("email, full_name, role").eq("is_active", true).order("full_name"),
    supabase.from("property_staff").select("email").eq("property_id", p.id),
    getSetupStatus(p.id),
  ]);
  const assigned = new Set((staff ?? []).map((s) => s.email));
  const admins = (members ?? []).filter((m) => m.role === "ADMIN");
  const others = (members ?? []).filter((m) => m.role !== "ADMIN");
  const blockers = activationBlockers(status);

  return (
    <>
      <ActionForm action={saveStaff} submitLabel="Save staff">
        <h2>Who works at {p.name} <span>Admins always have access: {admins.map((a) => a.full_name ?? a.email).join(", ") || "none"}</span></h2>
        <input type="hidden" name="property_id" value={p.id} />
        {others.length === 0 ? (
          <p className="hint">No managers, front desk or accountants on the team yet. Add them in Settings → Team.</p>
        ) : (
          <div className="checks">
            {others.map((m) => (
              <label key={m.email} className="check">
                <input type="checkbox" name="emails" value={m.email} defaultChecked={assigned.has(m.email)} />
                {m.full_name ?? m.email}
                <span className="dim" style={{ fontSize: 12 }}>{ROLE_LABEL[m.role as Role]}</span>
              </label>
            ))}
          </div>
        )}
      </ActionForm>

      {p.status === "DRAFT" && (
        <ActionForm action={activateProperty} submitLabel="Open for bookings" className="card">
          <h2>Open {p.name} <span>Staff can take bookings once it&apos;s open</span></h2>
          <input type="hidden" name="property_id" value={p.id} />
          {blockers.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)" }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          ) : (
            <p className="hint">Everything needed is set: room types, units, rates{status.needs_utilities ? " and meter prices" : ""}.</p>
          )}
        </ActionForm>
      )}
    </>
  );
}
