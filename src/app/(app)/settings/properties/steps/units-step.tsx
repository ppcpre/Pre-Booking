import Link from "next/link";
import { ActionForm, InlineAction, SubmitButton } from "@/components/action-form";
import { getProperty, getRoomTypes, getUnits } from "@/lib/properties";
import { addUnits, deleteUnit, updateUnit } from "../actions";
import { NextStep } from "./next-link";

export async function UnitsStep({ propertyCode }: { propertyCode: string }) {
  const p = await getProperty(propertyCode);
  const [types, units] = await Promise.all([getRoomTypes(p.id), getUnits(p.id)]);
  if (types.length === 0) {
    return (
      <div className="empty">
        <b>Add a room type first</b>
        <span>Each unit belongs to a room type, which sets its rates and capacity.</span>
        <Link className="btn primary" href={`/settings/properties/${p.code}/rooms`}>Go to room types</Link>
      </div>
    );
  }
  return (
    <>
      <ActionForm action={addUnits} submitLabel="Add units" footer={<NextStep code={p.code} from="units" />}>
        <h2>Add a range of units <span>e.g. 301 to 320 adds 20 units. Use the same number twice for one unit.</span></h2>
        <input type="hidden" name="property_id" value={p.id} />
        <div className="form f4">
          <label className="lb">From<input className="field" name="from" inputMode="numeric" required placeholder="301" /></label>
          <label className="lb">To<input className="field" name="to" inputMode="numeric" placeholder="320" /></label>
          <label className="lb">Prefix<small>Optional, e.g. A → A1, A2</small><input className="field" name="prefix" maxLength={6} /></label>
          <label className="lb">Floor<input className="field" name="floor" maxLength={10} placeholder="3" /></label>
          <label className="lb">Room type
            <select className="field" name="room_type_id" required>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <div className="lb full">Rent as
            <div className="checks">
              <label className="check"><input type="checkbox" name="modes" value="DAILY" defaultChecked />Daily</label>
              <label className="check"><input type="checkbox" name="modes" value="YEARLY" defaultChecked />Yearly</label>
            </div>
          </div>
        </div>
      </ActionForm>

      {units.length > 0 && (
        <div className="panel tw">
          <table className="t">
            <thead><tr><th>Unit</th><th>Floor</th><th>Room type</th><th>Daily</th><th>Yearly</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {units.map((u) => {
                const f = `unit-${u.id}`;
                return (
                  <tr key={u.id}>
                    <td className="unit">{u.code}</td>
                    <td>{u.floor ?? <span className="dim">–</span>}</td>
                    <td>
                      <select className="field" name="room_type_id" form={f} defaultValue={u.room_type_id} aria-label={`Room type of ${u.code}`} style={{ padding: "5px 28px 5px 9px", minWidth: 130 }}>
                        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    <td><input type="checkbox" name="modes" value="DAILY" form={f} defaultChecked={u.allowed_modes.includes("DAILY")} aria-label={`${u.code} daily`} /></td>
                    <td><input type="checkbox" name="modes" value="YEARLY" form={f} defaultChecked={u.allowed_modes.includes("YEARLY")} aria-label={`${u.code} yearly`} /></td>
                    <td>
                      <select className="field" name="status" form={f} defaultValue={u.status} aria-label={`Status of ${u.code}`} style={{ padding: "5px 28px 5px 9px", minWidth: 130 }}>
                        <option value="ACTIVE">Active</option>
                        <option value="MAINTENANCE">Maintenance</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    </td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      <form id={f} action={updateUnit} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={u.id} />
                        <SubmitButton className="btn sm">Save</SubmitButton>
                      </form>{" "}
                      <InlineAction action={deleteUnit} fields={{ id: u.id }} label="Delete" className="btn sm quiet danger" confirmText={`Delete unit ${u.code}?`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
