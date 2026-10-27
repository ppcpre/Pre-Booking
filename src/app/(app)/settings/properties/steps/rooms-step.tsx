import { ActionForm, InlineAction } from "@/components/action-form";
import { getProperty, getRoomTypes, getUnits } from "@/lib/properties";
import { addRoomType, deleteRoomType } from "../actions";
import { NextStep } from "./next-link";

export async function RoomsStep({ propertyCode }: { propertyCode: string }) {
  const p = await getProperty(propertyCode);
  const [types, units] = await Promise.all([getRoomTypes(p.id), getUnits(p.id)]);
  return (
    <>
      {types.length > 0 && (
        <div className="panel tw">
          <table className="t">
            <thead><tr><th>Room type</th><th className="r">Max guests</th><th className="r">Size</th><th>Amenities</th><th className="r">Units</th><th></th></tr></thead>
            <tbody>
              {types.map((t) => {
                const n = units.filter((u) => u.room_type_id === t.id).length;
                return (
                  <tr key={t.id}>
                    <td><b style={{ fontWeight: 500 }}>{t.name}</b></td>
                    <td className="r">{t.max_occupancy}</td>
                    <td className="r">{t.size_sqm ? `${t.size_sqm} m²` : "–"}</td>
                    <td className="hint">{t.amenities.join(", ") || "–"}</td>
                    <td className="r">{n}</td>
                    <td className="r">
                      {n === 0 ? (
                        <InlineAction action={deleteRoomType} fields={{ id: t.id }} label="Delete" className="btn sm quiet danger" confirmText={`Delete ${t.name}?`} />
                      ) : (
                        <span className="hint">in use</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ActionForm action={addRoomType} submitLabel="Add room type" resetOnSuccess footer={<NextStep code={p.code} from="rooms" />}>
        <h2>Add a room type <span>e.g. Studio, One bedroom, Family room</span></h2>
        <input type="hidden" name="property_id" value={p.id} />
        <div className="form f4">
          <label className="lb">Name<input className="field" name="name" required placeholder="Studio" /></label>
          <label className="lb">Max guests<input className="field" name="max_occupancy" type="number" min={1} max={50} defaultValue={2} required /></label>
          <label className="lb">Size (m²)<input className="field" name="size_sqm" inputMode="decimal" placeholder="28" /></label>
          <label className="lb">Amenities<small>Comma separated</small><input className="field" name="amenities" placeholder="Air con, Wi-Fi, Fridge" /></label>
        </div>
      </ActionForm>
    </>
  );
}
