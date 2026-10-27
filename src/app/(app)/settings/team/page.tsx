import { ActionForm, InlineAction, SubmitButton } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/session";
import { listProperties } from "@/lib/properties";
import { ROLE_LABEL, type Role, type TeamMember } from "@/lib/types";
import { addMember, changeRole, setActive } from "./actions";

export const metadata = { title: "Team" };

const ROLES = Object.entries(ROLE_LABEL) as [Role, string][];
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(iso)) : "–";

export default async function TeamPage() {
  const me = await requireRole("ADMIN");
  const supabase = await createClient();
  const [{ data: members }, { data: staff }, properties] = await Promise.all([
    supabase.from("team_members").select("*").order("is_active", { ascending: false }).order("added_at"),
    supabase.from("property_staff").select("email, properties(name)"),
    listProperties(),
  ]);
  const assigned = new Map<string, string[]>();
  for (const s of staff ?? []) {
    const name = (s.properties as unknown as { name: string } | null)?.name;
    if (name) assigned.set(s.email, [...(assigned.get(s.email) ?? []), name]);
  }
  const open = properties.filter((p) => p.status !== "ARCHIVED");

  return (
    <div className="page">
      <div className="head">
        <div><h1>Team</h1><p>People who can sign in with their Google account. Everyone works on the same live data.</p></div>
      </div>

      <ActionForm action={addMember} submitLabel="Add member" resetOnSuccess>
        <h2>Add member <span>They sign in with this Google account. No password needed.</span></h2>
        <div className="form f3">
          <label className="lb">Google email<input className="field" name="email" type="email" required placeholder="name@gmail.com" autoComplete="off" /></label>
          <label className="lb">Role
            <select className="field" name="role" defaultValue="FRONT_DESK">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <div className="lb">Properties<small>Admins see every property</small></div>
          {open.length > 0 && (
            <div className="checks full">
              {open.map((p) => (
                <label key={p.id} className="check"><input type="checkbox" name="property_ids" value={p.id} />{p.name}</label>
              ))}
            </div>
          )}
        </div>
      </ActionForm>

      <div className="panel tw">
        <table className="t">
          <thead><tr><th>Member</th><th>Role</th><th>Properties</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            {((members ?? []) as TeamMember[]).map((m) => {
              const isMe = m.email === me.email;
              return (
                <tr key={m.email}>
                  <td><b style={{ fontWeight: 500 }}>{m.full_name ?? <span className="dim">Waiting for first sign-in</span>}</b><div className="hint">{m.email}{isMe && " · you"}</div></td>
                  <td>
                    <form action={changeRole} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="email" value={m.email} />
                      <select className="field" name="role" defaultValue={m.role} style={{ width: 140, padding: "5px 28px 5px 9px" }} aria-label={`Role for ${m.email}`}>
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <SubmitButton className="btn sm">Save</SubmitButton>
                    </form>
                  </td>
                  <td className="hint">{m.role === "ADMIN" ? "All properties" : (assigned.get(m.email) ?? []).join(", ") || "None yet"}</td>
                  <td>
                    {!m.is_active ? <span className="st bad">Deactivated</span> : m.user_id ? <span className="st ok">Active</span> : <span className="st idle">Not signed in yet</span>}
                  </td>
                  <td className="hint">{when(m.last_sign_in)}</td>
                  <td className="r">
                    {!isMe && (
                      <InlineAction
                        action={setActive}
                        fields={{ email: m.email, active: String(!m.is_active) }}
                        label={m.is_active ? "Deactivate" : "Reactivate"}
                        className={`btn sm ${m.is_active ? "danger" : ""}`}
                        confirmText={m.is_active ? `Deactivate ${m.email}? They lose access on every device right away.` : undefined}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Deactivating someone blocks them immediately: every page and every data request checks that they are still active. The team always keeps at least one active admin.</p>
    </div>
  );
}
