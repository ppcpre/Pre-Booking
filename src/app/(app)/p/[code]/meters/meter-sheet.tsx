"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CameraIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { formatTHB } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import type { MeterRow, Utility } from "@/lib/meters";
import { billUtilities, saveReadings } from "../actions";

type Props = { propertyId: string; propertyCode: string; date: string; utility: Utility; rows: MeterRow[]; canEdit: boolean };
type RowState = { value: string; photoPath?: string; preview?: string | null; allowLower: boolean; error?: string; uploading?: boolean };

/** Shrinks a photo to at most 1600 px on the long side (JPEG) so uploads stay small on mobile data. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read the photo"))), "image/jpeg", 0.82));
}

export function MeterSheet({ propertyId, propertyCode, date, utility, rows, canEdit }: Props) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.unitId, { value: r.current ? String(r.current.value) : "", preview: r.current?.photoUrl ?? null, allowLower: false }])),
  );
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<RowState>) => setState((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const done = rows.filter((r) => state[r.unitId]?.value.trim()).length;

  async function upload(r: MeterRow, file: File | undefined) {
    if (!file) return;
    set(r.unitId, { uploading: true, error: undefined });
    try {
      const blob = await shrink(file);
      const path = `${propertyId}/${r.unitId}/${date}-${utility.toLowerCase()}-${Date.now()}.jpg`;
      const { error } = await createClient().storage.from("meter-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw new Error("Photo upload failed. Check your connection.");
      set(r.unitId, { photoPath: path, preview: URL.createObjectURL(blob), uploading: false });
    } catch (e) {
      set(r.unitId, { uploading: false, error: (e as Error).message });
    }
  }

  function save(thenBill: boolean) {
    setMsg(null);
    start(async () => {
      const res = await saveReadings({
        propertyCode,
        date,
        utility,
        rows: rows
          .filter((r) => !r.current?.billed)
          .map((r) => ({ unit_id: r.unitId, value: state[r.unitId]!.value, photo_path: state[r.unitId]!.photoPath, allow_lower: state[r.unitId]!.allowLower })),
      });
      if (!res.ok) return setMsg({ err: res.error });
      setState((s) => {
        const next = { ...s };
        for (const id of Object.keys(next)) next[id] = { ...next[id]!, error: res.data.errors.find((e) => e.unit_id === id)?.error };
        return next;
      });
      if (res.data.errors.length) {
        setMsg({ err: `Saved ${res.data.saved}. ${res.data.errors.length} need checking (marked below).` });
        router.refresh();
        return;
      }
      if (!thenBill) {
        setMsg({ ok: `Saved ${res.data.saved} reading${res.data.saved === 1 ? "" : "s"}.` });
        router.refresh();
        return;
      }
      const b = await billUtilities({ propertyId, propertyCode, date });
      if (!b.ok) setMsg({ err: b.error });
      else
        setMsg({
          ok: `Saved ${res.data.saved}. Added ${formatTHB(b.data.total)} to ${b.data.billed} tenant bill${b.data.billed === 1 ? "" : "s"}.` +
            (b.data.skipped ? ` ${b.data.skipped} not billed (no starting reading for the tenant, or nothing used).` : ""),
        });
      router.refresh();
    });
  }

  return (
    <>
      <div style={{ display: "grid", gap: 6 }}>
        <div className="bar2"><i style={{ width: `${(done / rows.length) * 100}%` }} /></div>
        <span className="hint">{done} of {rows.length} read on {fmtDate(date)}</span>
      </div>
      <div className="panel tw">
        <table className="t">
          <thead><tr><th>Unit</th><th>Tenant</th><th className="r">Last</th><th className="r">This reading</th><th className="r">Used</th><th>Photo</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const st = state[r.unitId]!;
              const v = st.value.trim() === "" ? null : Number(st.value.replace(/,/g, ""));
              const used = v !== null && r.last ? v - r.last.value : null;
              const lower = used !== null && used < 0;
              const odd = used !== null && r.avgUse && r.avgUse > 0 && used > r.avgUse * 3;
              const locked = !!r.current?.billed || !canEdit;
              return (
                <tr key={r.unitId}>
                  <td className="unit">{r.unitCode}<div className="hint">{r.floor ? `Floor ${r.floor}` : ""}</div></td>
                  <td>{r.tenant ? (r.bookingCode ? <Link href={`/p/${propertyCode}/bookings/${r.bookingCode}`}>{r.tenant}</Link> : r.tenant) : <span className="dim">Vacant</span>}</td>
                  <td className="r">{r.last ? <>{r.last.value.toLocaleString("en-US")}<div className="hint">{fmtDate(r.last.date, false)}</div></> : <span className="dim">–</span>}</td>
                  <td className="r">
                    <input
                      className="field"
                      style={{ width: 120, textAlign: "right", borderColor: lower || st.error ? "var(--coral)" : undefined }}
                      inputMode="decimal"
                      value={st.value}
                      disabled={locked}
                      aria-label={`Unit ${r.unitCode} reading`}
                      data-row={i}
                      onChange={(e) => set(r.unitId, { value: e.target.value, error: undefined })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (document.querySelector(`input[data-row="${i + 1}"]`) as HTMLInputElement | null)?.focus();
                        }
                      }}
                    />
                    {r.current?.billed && <div className="hint">billed</div>}
                    {lower && !locked && (
                      <label className="hint" style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", marginTop: 4 }}>
                        <input type="checkbox" checked={st.allowLower} onChange={(e) => set(r.unitId, { allowLower: e.target.checked })} />meter replaced
                      </label>
                    )}
                    {st.error && <div className="hint" style={{ color: "var(--coral)", maxWidth: 260, marginLeft: "auto" }}>{st.error}</div>}
                  </td>
                  <td className="r" style={{ color: lower ? "var(--coral)" : odd ? "var(--amber)" : undefined }}>
                    {used === null ? <span className="dim">–</span> : used.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    {lower && <div className="hint" style={{ color: "var(--coral)" }}>lower than last</div>}
                    {odd && <div className="hint" style={{ color: "var(--amber)" }}>3× usual</div>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {st.preview && <a href={st.preview} target="_blank" rel="noreferrer"><img src={st.preview} alt={`Meter ${r.unitCode}`} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8 }} /></a>}
                      {!locked && (
                        <label className="attach" style={{ height: 34 }}>
                          <CameraIcon />{st.uploading ? "…" : st.preview ? "Replace" : "Photo"}
                          <input type="file" accept="image/*" capture="environment" onChange={(e) => upload(r, e.target.files?.[0])} />
                        </label>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {msg?.err && <div className="msg err" role="alert">{msg.err}</div>}
      {msg?.ok && <div className="msg ok" role="status">{msg.ok}</div>}
      {canEdit && (
        <div className="formfoot">
          <span className="hint">Enter moves to the next unit. Billing adds each tenant&apos;s use to their next monthly bill and can be run again safely.</span>
          <div className="actions">
            <button className="btn" type="button" disabled={pending} onClick={() => save(false)}>Save readings</button>
            <button className="btn primary" type="button" disabled={pending} onClick={() => save(true)}>{pending ? "Working…" : "Save and add to bills"}</button>
          </div>
        </div>
      )}
    </>
  );
}
