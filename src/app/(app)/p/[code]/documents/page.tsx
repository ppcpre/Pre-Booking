import Link from "next/link";
import { requireMember } from "@/lib/session";
import { getProperty } from "@/lib/properties";
import { listDocuments } from "@/lib/documents";
import { formatTHB } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  await requireMember();
  const p = await getProperty(code);
  const type = sp.type === "INVOICE" ? "INVOICE" : sp.type === "RECEIPT" ? "RECEIPT" : null;
  const docs = await listDocuments(p.id, type);
  const base = `/p/${p.code}/documents`;
  return (
    <>
      <div className="seg" style={{ justifySelf: "start" }}>
        <Link href={base} aria-current={!type ? "page" : undefined}>All</Link>
        <Link href={`${base}?type=INVOICE`} aria-current={type === "INVOICE" ? "page" : undefined}>Invoices</Link>
        <Link href={`${base}?type=RECEIPT`} aria-current={type === "RECEIPT" ? "page" : undefined}>Receipts</Link>
      </div>
      {docs.length === 0 ? (
        <div className="empty"><b>No documents yet</b><span>Receipts are issued when you record a payment. Invoices are issued from a booking.</span></div>
      ) : (
        <div className="panel tw">
          <table className="t">
            <thead><tr><th>Number</th><th>Type</th><th>Date</th><th>Bill to</th><th>Booking</th><th className="r">Total</th><th>Status</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="link" style={{ opacity: d.status === "VOID" ? 0.55 : 1 }}>
                  <td><Link className="rowlink code" href={`${base}/${d.number}`}>{d.number}</Link></td>
                  <td>{d.type === "INVOICE" ? "Invoice" : "Receipt"}</td>
                  <td>{fmtDate(d.issue_date)}</td>
                  <td>{d.bill_to.name} <span className="dim">· {d.bill_to.unit}</span></td>
                  <td><Link className="rowlink code" href={`/p/${p.code}/bookings/${d.bill_to.booking_code}`}>{d.bill_to.booking_code}</Link></td>
                  <td className="r">{formatTHB(d.total)}</td>
                  <td>{d.status === "VOID" ? <span className="st bad">Void</span> : <span className="st ok">Issued</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
