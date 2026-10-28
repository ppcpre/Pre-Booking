/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ActionDialog } from "@/components/action-dialog";
import { requireMember } from "@/lib/session";
import { getProperty } from "@/lib/properties";
import { getDocument } from "@/lib/documents";
import { signedPhotoUrls } from "@/lib/photos";
import { formatTHB } from "@/lib/money";
import { fmtDate, fmtRange } from "@/lib/dates";
import { amountInWords } from "@/lib/words";
import { METHOD_LABEL } from "@/lib/booking-rules";
import { voidDocument } from "../../actions";
import { PrintButton } from "./print-button";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  return { title: (await params).number };
}

const money = (satang: number) => (satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function DocumentPage({ params }: { params: Promise<{ code: string; number: string }> }) {
  const { code, number } = await params;
  const member = await requireMember();
  const p = await getProperty(code);
  const d = await getDocument(number);
  const urls = await signedPhotoUrls([d.issuer.photo_path]);
  const logo = d.issuer.photo_path ? urls[d.issuer.photo_path] : null;
  const x = (d.extra ?? {}) as Record<string, unknown>;
  const isReceipt = d.type === "RECEIPT";
  const wht = Number(x.wht_amount ?? 0);
  const stay = x.stay as { check_in: string; check_out: string; mode: string } | undefined;

  return (
    <>
      <div className="head no-print">
        <div>
          <div className="crumb"><Link href={`/p/${p.code}/documents`}>Documents</Link> / <span className="code">{d.number}</span></div>
          <p>{isReceipt ? "Receipt" : "Invoice"} for <Link href={`/p/${p.code}/bookings/${d.bill_to.booking_code}`}>{d.bill_to.booking_code}</Link>{d.status === "VOID" ? ` · void: ${d.void_reason}` : ""}</p>
        </div>
        <div className="actions">
          {d.status === "ISSUED" && member.role !== "FRONT_DESK" && (
            <ActionDialog label="Void" title={`Void ${d.number}`} action={voidDocument} submitLabel="Void document" triggerClass="btn quiet danger" submitClass="btn danger">
              <input type="hidden" name="document_id" value={d.id} />
              <input type="hidden" name="property_code" value={p.code} />
              <label className="lb">Reason<input className="field" name="reason" required placeholder="Wrong amount" /></label>
              <p className="hint" style={{ margin: 0 }}>The number stays used. Issue a new {isReceipt ? "receipt" : "invoice"} if needed.</p>
            </ActionDialog>
          )}
          <PrintButton />
        </div>
      </div>

      <article className={`paper ${d.status === "VOID" ? "void" : ""}`}>
        <header className="paper-top">
          <div style={{ display: "grid", gap: 4 }}>
            {logo ? <img src={logo} alt="" className="paper-logo" /> : <span className="paper-logo initials">{d.issuer.property.charAt(0)}</span>}
            <b>{d.issuer.property}</b>
            <span className="mut">{d.issuer.name}</span>
            {d.issuer.address && <span className="mut" style={{ whiteSpace: "pre-line" }}>{d.issuer.address}</span>}
            {(d.issuer.tax_id || d.issuer.phone) && <span className="mut">{[d.issuer.tax_id && `Tax ID ${d.issuer.tax_id}`, d.issuer.phone].filter(Boolean).join(" · ")}</span>}
          </div>
          <div className="paper-meta">
            <h2>{isReceipt ? "RECEIPT" : "INVOICE"}</h2>
            <span>No. {d.number}</span>
            <span className="mut">Date {fmtDate(d.issue_date)}</span>
            {!isReceipt && d.due_date && <span className="mut">Due {fmtDate(d.due_date)}</span>}
          </div>
        </header>

        <section style={{ display: "grid", gap: 2 }}>
          <span className="lbl">{isReceipt ? "Received from" : "Bill to"}</span>
          <b>{d.bill_to.name}</b>
          {d.bill_to.attention && <span className="mut">Attn: {d.bill_to.attention}</span>}
          {d.bill_to.address && <span className="mut" style={{ whiteSpace: "pre-line" }}>{d.bill_to.address}</span>}
          {(d.bill_to.tax_id || d.bill_to.branch) && <span className="mut">{[d.bill_to.tax_id && `Tax ID ${d.bill_to.tax_id}`, d.bill_to.branch].filter(Boolean).join(" · ")}</span>}
          <span className="mut">Booking {d.bill_to.booking_code} · Unit {d.bill_to.unit}{stay ? ` · ${fmtRange(stay.check_in, stay.check_out)}` : ""}</span>
        </section>

        <table className="paper-lines">
          <thead><tr><th>Description</th><th className="r">Amount (THB)</th></tr></thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className="r">{money(l.amount)}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="paper-total"><span>{isReceipt ? "Total" : "Amount due"}</span><span>THB {money(d.total)}</span></div>
        {isReceipt && wht > 0 && (
          <>
            <div className="paper-sub"><span>Withholding tax{x.wht_cert_no ? ` (cert. ${String(x.wht_cert_no)})` : ""}</span><span>− {money(wht)}</span></div>
            <div className="paper-sub"><b>Amount received</b><b>THB {money(Number(x.received ?? d.total - wht))}</b></div>
          </>
        )}
        <div className="mut">{amountInWords(isReceipt ? Number(x.received ?? d.total) : d.total)}</div>

        {isReceipt ? (
          <footer className="paper-foot">
            <span>Paid by {METHOD_LABEL[String(x.method)] ?? String(x.method)}{x.reference ? ` · ref ${String(x.reference)}` : ""}<br /><span className="mut">Balance remaining on this booking: THB {money(Number(x.balance_after ?? 0))}</span></span>
            <span className="sign">Received by ______________________</span>
          </footer>
        ) : (
          <footer className="paper-foot">
            <span>{x.payment_instructions ? <>How to pay<br /><span className="mut" style={{ whiteSpace: "pre-line" }}>{String(x.payment_instructions)}</span></> : <span className="mut">Please pay by the due date.</span>}</span>
            <span className="mut">Thank you</span>
          </footer>
        )}
        {d.status === "VOID" && <div className="void-stamp" aria-hidden="true">VOID</div>}
      </article>
    </>
  );
}
