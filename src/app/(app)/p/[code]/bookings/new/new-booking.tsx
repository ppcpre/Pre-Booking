"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatTHB, bahtToSatang } from "@/lib/money";
import { addDays, addYears, daysBetween, fmtDate, fmtRange } from "@/lib/dates";
import { BOOKING_SOURCES } from "@/lib/booking-rules";
import { createBooking, findUnits, quoteBooking, searchGuests, type AvailableUnit, type GuestHit, type Quote } from "../../actions";

type Props = {
  property: { id: string; code: string; name: string; checkIn: string };
  today: string;
  initial: { mode: "DAILY" | "YEARLY"; start: string; unitId: string | null };
  modes: { daily: boolean; yearly: boolean };
};

type NewGuest = { full_name: string; phone: string; email: string; line_id: string; nationality: string; is_company: boolean; company_name: string; tax_id: string; branch: string; billing_address: string };
const EMPTY_GUEST: NewGuest = { full_name: "", phone: "", email: "", line_id: "", nationality: "", is_company: false, company_name: "", tax_id: "", branch: "", billing_address: "" };

const STEPS = ["Rental type", "Dates & unit", "Guest", "Review"] as const;

export function NewBooking({ property, today, initial, modes }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initial.unitId ? 1 : 0);
  const [mode, setMode] = useState<"DAILY" | "YEARLY">(modes.daily ? initial.mode : "YEARLY");
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(addDays(initial.start, 1));
  const [years, setYears] = useState(1);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [units, setUnits] = useState<AvailableUnit[] | null>(null);
  const [unitId, setUnitId] = useState<string | null>(initial.unitId);
  const [guestQuery, setGuestQuery] = useState("");
  const [hits, setHits] = useState<GuestHit[]>([]);
  const [guest, setGuest] = useState<GuestHit | null>(null);
  const [newGuest, setNewGuest] = useState<NewGuest | null>(null);
  const [extras, setExtras] = useState<{ description: string; amount: string }[]>([]);
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [source, setSource] = useState("WALK_IN");
  const [note, setNote] = useState("");
  const [payBy, setPayBy] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));

  const guests = adults + children;
  const stayEnd = mode === "DAILY" ? end : addYears(start, years);
  const nights = daysBetween(start, end);
  const chosen = units?.find((u) => u.unit_id === unitId) ?? null;

  // Auto-search when the dates arrive prefilled from the calendar.
  useEffect(() => {
    if (initial.unitId) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guest search as you type.
  useEffect(() => {
    if (guestQuery.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => setHits(await searchGuests(guestQuery)), 250);
    return () => clearTimeout(t);
  }, [guestQuery]);

  const parsedExtras = useMemo(() => {
    try {
      return { ok: true as const, value: extras.filter((e) => e.description.trim() && e.amount.trim()).map((e) => ({ description: e.description.trim(), amount: bahtToSatang(e.amount) })) };
    } catch {
      return { ok: false as const, value: [] };
    }
  }, [extras]);
  const discountSatang = useMemo(() => {
    try {
      return discount.trim() ? bahtToSatang(discount) : 0;
    } catch {
      return -1;
    }
  }, [discount]);

  function search() {
    setError(null);
    startTransition(async () => {
      const r = await findUnits({ propertyId: property.id, mode, start, end: mode === "DAILY" ? end : undefined, years, guests });
      if (!r.ok) {
        setUnits(null);
        setError(r.error);
        return;
      }
      setUnits(r.data);
      if (unitId && !r.data.some((u) => u.unit_id === unitId && u.available)) setUnitId(null);
    });
  }

  function refreshQuote() {
    if (!unitId) return;
    if (!parsedExtras.ok) return setError("Extra charges: enter amounts like 300");
    if (discountSatang < 0) return setError("Discount: enter an amount like 200");
    setError(null);
    startTransition(async () => {
      const r = await quoteBooking({ unitId, mode, start, end: mode === "DAILY" ? end : undefined, years, adults, children, extras: parsedExtras.value, discount: discountSatang });
      if (!r.ok) {
        setQuote(null);
        setError(r.error);
      } else setQuote(r.data);
    });
  }

  useEffect(() => {
    if (step === 3) refreshQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function save(takePayment: boolean) {
    if (!unitId) return;
    if (discountSatang > 0 && !discountReason.trim()) return setError("Give a reason for the discount");
    setError(null);
    startTransition(async () => {
      const r = await createBooking({
        propertyCode: property.code,
        unitId,
        mode,
        start,
        end: mode === "DAILY" ? end : undefined,
        years,
        adults,
        children,
        extras: parsedExtras.ok ? parsedExtras.value : [],
        discount: Math.max(discountSatang, 0),
        discountReason: discountReason || undefined,
        guestId: guest?.id,
        guest: guest ? undefined : newGuest ? { ...newGuest, email: newGuest.email || undefined } : undefined,
        payBy: payBy ? new Date(payBy).toISOString() : undefined, // datetime-local is in the device's time zone
        source,
        note: note || undefined,
        idempotencyKey: key,
      });
      if (!r.ok) {
        setError(r.error);
        if (/just booked/i.test(r.error)) {
          setStep(1);
          search();
        }
        return;
      }
      router.push(`/p/${property.code}/bookings/${r.data.code}${takePayment ? "?pay=1" : ""}`);
    });
  }

  const guestReady = !!guest || (!!newGuest && newGuest.full_name.trim().length > 0);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <nav className="steps" aria-label="Booking steps">
        {STEPS.map((s, i) => (
          <a key={s} href="#" className={i < step ? "done" : undefined} aria-current={i === step ? "step" : undefined}
            onClick={(e) => { e.preventDefault(); if (i < step) setStep(i); }}>{s}</a>
        ))}
      </nav>

      {error && <div className="msg err" role="alert">{error}</div>}

      {step === 0 && (
        <div className="choices">
          <button type="button" className="choice" aria-pressed={mode === "DAILY"} disabled={!modes.daily} onClick={() => { setMode("DAILY"); setUnits(null); setStep(1); }}>
            <b>Daily</b><p>Nights with check-in and check-out. Reserve now, pay in full before check-in. Utilities included.</p>
            {!modes.daily && <p>No units here are rented daily.</p>}
          </button>
          <button type="button" className="choice" aria-pressed={mode === "YEARLY"} disabled={!modes.yearly} onClick={() => { setMode("YEARLY"); setUnits(null); setStep(1); }}>
            <b>Yearly</b><p>Lease of one year or more. Deposit and first month to move in, then rent monthly. Water and electricity by meter.</p>
            {!modes.yearly && <p>No units here are rented yearly.</p>}
          </button>
        </div>
      )}

      {step === 1 && (
        <>
          <div className="card">
            <h2>{mode === "DAILY" ? "Dates and guests" : "Lease and tenants"} <span>{mode === "DAILY" ? "Daily" : "Yearly"} · <a href="#" onClick={(e) => { e.preventDefault(); setStep(0); }}>change</a></span></h2>
            <div className="form f4">
              <label className="lb">{mode === "DAILY" ? "Check-in" : "Move-in"}
                <input className="field" type="date" min={today} value={start} onChange={(e) => { const v = e.target.value; setStart(v); if (end <= v) setEnd(addDays(v, 1)); setUnits(null); }} />
              </label>
              {mode === "DAILY" ? (
                <label className="lb">Check-out<small>{nights > 0 ? `${nights} night${nights > 1 ? "s" : ""}` : "after check-in"}</small>
                  <input className="field" type="date" min={addDays(start, 1)} value={end} onChange={(e) => { setEnd(e.target.value); setUnits(null); }} />
                </label>
              ) : (
                <label className="lb">Term<small>ends {fmtDate(stayEnd)}</small>
                  <select className="field" value={years} onChange={(e) => { setYears(Number(e.target.value)); setUnits(null); }}>
                    {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} year{y > 1 ? "s" : ""}</option>)}
                  </select>
                </label>
              )}
              <label className="lb">Adults<input className="field" type="number" min={1} max={20} value={adults} onChange={(e) => { setAdults(Math.max(1, Number(e.target.value))); setUnits(null); }} /></label>
              <label className="lb">Children<input className="field" type="number" min={0} max={20} value={children} onChange={(e) => { setChildren(Math.max(0, Number(e.target.value))); setUnits(null); }} /></label>
            </div>
            <div className="formfoot"><span className="hint">{fmtRange(start, stayEnd)}</span><button className="btn primary" type="button" disabled={pending} onClick={search}>{pending ? "Searching…" : "Find available units"}</button></div>
          </div>

          {units && (
            <div className="card">
              <h2>Choose a unit <span>{units.filter((u) => u.available).length} of {units.length} available</span></h2>
              <div className="unit-pick">
                {units.map((u) => (
                  <button key={u.unit_id} type="button" disabled={!u.available} aria-pressed={u.unit_id === unitId} onClick={() => setUnitId(u.unit_id)}>
                    <b>{u.code}</b>
                    <small>{u.room_type}{u.floor ? ` · floor ${u.floor}` : ""}</small>
                    <small style={{ color: u.available ? "var(--ink)" : undefined }}>
                      {u.available ? (mode === "DAILY" ? formatTHB(u.total) : `${formatTHB(u.rent)}/month`) : u.reason}
                    </small>
                  </button>
                ))}
              </div>
              <div className="formfoot"><span className="hint">{chosen ? `Unit ${chosen.code} selected` : "Pick an available unit"}</span><button className="btn primary" type="button" disabled={!chosen} onClick={() => setStep(2)}>Next: guest</button></div>
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <div className="card">
          <h2>{mode === "DAILY" ? "Guest" : "Tenant"} <span>Search earlier guests or add a new one</span></h2>
          {!newGuest && (
            <>
              <input className="field" placeholder="Name, phone, email or company" value={guestQuery} onChange={(e) => { setGuestQuery(e.target.value); setGuest(null); }} aria-label="Search guests" autoFocus />
              {hits.length > 0 && !guest && (
                <div className="list">
                  {hits.map((h) => (
                    <button key={h.id} type="button" className="it" style={{ all: "unset", cursor: "pointer", display: "grid", gridTemplateColumns: "1fr auto", padding: "8px 0", borderBottom: "1px solid var(--line)" }} onClick={() => { setGuest(h); setGuestQuery(h.full_name); }}>
                      <span><b style={{ fontWeight: 500 }}>{h.full_name}</b> <span className="hint">{[h.company_name, h.phone, h.email].filter(Boolean).join(" · ")}</span></span>
                      <span className="btn sm">Choose</span>
                    </button>
                  ))}
                </div>
              )}
              {guest && <div className="notice mint"><span><b>{guest.full_name}</b> {[guest.phone, guest.email].filter(Boolean).join(" · ")}</span><button className="btn sm quiet" type="button" onClick={() => { setGuest(null); setGuestQuery(""); }}>Change</button></div>}
              {!guest && <div><button className="btn" type="button" onClick={() => setNewGuest({ ...EMPTY_GUEST, full_name: guestQuery.trim() })}>+ New {mode === "DAILY" ? "guest" : "tenant"}</button></div>}
            </>
          )}
          {newGuest && (
            <>
              <div className="form">
                <label className="lb">Full name<input className="field" required value={newGuest.full_name} onChange={(e) => setNewGuest({ ...newGuest, full_name: e.target.value })} /></label>
                <label className="lb">Phone<input className="field" type="tel" value={newGuest.phone} onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })} /></label>
                <label className="lb">Email<input className="field" type="email" value={newGuest.email} onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })} /></label>
                <label className="lb">LINE ID<input className="field" value={newGuest.line_id} onChange={(e) => setNewGuest({ ...newGuest, line_id: e.target.value })} /></label>
                <label className="lb">Nationality<input className="field" value={newGuest.nationality} onChange={(e) => setNewGuest({ ...newGuest, nationality: e.target.value })} /></label>
                <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={newGuest.is_company} onChange={(e) => setNewGuest({ ...newGuest, is_company: e.target.checked })} />Company pays (bill to company)</label>
                {newGuest.is_company && (
                  <>
                    <label className="lb">Company name<input className="field" value={newGuest.company_name} onChange={(e) => setNewGuest({ ...newGuest, company_name: e.target.value })} /></label>
                    <label className="lb">Tax ID<input className="field" inputMode="numeric" value={newGuest.tax_id} onChange={(e) => setNewGuest({ ...newGuest, tax_id: e.target.value })} /></label>
                    <label className="lb">Branch<input className="field" placeholder="Head office" value={newGuest.branch} onChange={(e) => setNewGuest({ ...newGuest, branch: e.target.value })} /></label>
                    <label className="lb full">Billing address<textarea className="field" value={newGuest.billing_address} onChange={(e) => setNewGuest({ ...newGuest, billing_address: e.target.value })} /></label>
                  </>
                )}
              </div>
              <div><button className="btn sm quiet" type="button" onClick={() => setNewGuest(null)}>Search existing guests instead</button></div>
            </>
          )}
          <div className="formfoot"><button className="btn quiet" type="button" onClick={() => setStep(1)}>← Back</button><button className="btn primary" type="button" disabled={!guestReady} onClick={() => setStep(3)}>Next: review</button></div>
        </div>
      )}

      {step === 3 && (
        <div className="split wide">
          <div className="card">
            <h2>Extras and details</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {extras.map((x, i) => (
                <div key={i} className="form" style={{ gridTemplateColumns: "1fr 140px auto" }}>
                  <input className="field" placeholder="e.g. Cleaning fee" value={x.description} aria-label="Extra charge" onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
                  <input className="field" placeholder="Amount ฿" inputMode="decimal" value={x.amount} aria-label="Extra charge amount" onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
                  <button className="btn quiet" type="button" onClick={() => setExtras(extras.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                </div>
              ))}
              <div><button className="btn sm" type="button" onClick={() => setExtras([...extras, { description: "", amount: "" }])}>+ Add charge{mode === "YEARLY" ? " (paid at move-in)" : ""}</button></div>
            </div>
            <div className="form">
              <label className="lb">{mode === "DAILY" ? "Discount on the stay (฿)" : "Discount per month (฿)"}<input className="field" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></label>
              <label className="lb">Discount reason<input className="field" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Repeat guest" /></label>
              <label className="lb">Booked via
                <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>{BOOKING_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label className="lb">Pay by<small>{mode === "DAILY" ? `Default: check-in time (${property.checkIn}) on arrival day` : "Default: the reservation window, at the latest on move-in"}</small>
                <input className="field" type="datetime-local" value={payBy} onChange={(e) => setPayBy(e.target.value)} />
              </label>
              <label className="lb full">Note<textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Late arrival, extra bed…" /></label>
            </div>
            <div><button className="btn sm" type="button" disabled={pending} onClick={refreshQuote}>Update price</button></div>
          </div>

          <div className="card summary">
            <div>
              <div className="hint">Unit {chosen?.code} · {chosen?.room_type}</div>
              <b>{fmtRange(start, stayEnd)}</b>
              <div className="hint">{guest?.full_name ?? newGuest?.full_name} · {adults + children} guest{adults + children > 1 ? "s" : ""}</div>
            </div>
            {!quote ? <span className="hint">{pending ? "Calculating…" : "Price unavailable"}</span> : mode === "DAILY" ? (
              <>
                {quote.periods[0]?.lines.map((l, i) => <div key={i} className="ln"><span>{l.description}</span><span>{formatTHB(l.amount)}</span></div>)}
                <div className="ln t"><span>Total</span><span>{formatTHB(quote.total)}</span></div>
                <div className="notice mint">Pay in full before check-in. The unit is held until then.</div>
              </>
            ) : (
              <>
                <div className="ln"><span>Rent</span><span>{formatTHB(quote.rent)}/month</span></div>
                {quote.periods.filter((p) => p.due_date <= start).map((p) => <div key={p.seq} className="ln"><span>{p.seq === 0 ? "Deposit and move-in" : `Rent ${p.label}`}</span><span>{formatTHB(p.total)}</span></div>)}
                <div className="ln t"><span>Due to move in</span><span>{formatTHB(quote.due_now)}</span></div>
                <div className="hint">Then {formatTHB(quote.rent)} each month from {fmtDate(quote.periods.find((p) => p.due_date > start)?.due_date ?? start)} · {quote.periods.filter((p) => p.kind === "RENT").length} months in total</div>
                <div className="notice mint">The lease confirms once the move-in amount is paid.</div>
              </>
            )}
            <div style={{ display: "grid", gap: 8 }}>
              <button className="btn primary" type="button" disabled={pending || !quote} onClick={() => save(true)}>{pending ? "Saving…" : "Save and take payment"}</button>
              <button className="btn" type="button" disabled={pending || !quote} onClick={() => save(false)}>Save reservation (pay later)</button>
              <button className="btn quiet" type="button" onClick={() => setStep(2)}>← Back</button>
            </div>
          </div>
        </div>
      )}

      <p className="hint"><Link href={`/p/${property.code}/calendar`}>Open the calendar</Link> to see availability across all units.</p>
    </div>
  );
}
