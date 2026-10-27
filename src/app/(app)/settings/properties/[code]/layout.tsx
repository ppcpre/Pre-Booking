import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getProperty, getSetupStatus } from "@/lib/properties";
import { setupProgress } from "@/lib/setup";
import { StepNav } from "../steps/step-nav";

export default async function PropertySetupLayout({ children, params }: { children: React.ReactNode; params: Promise<{ code: string }> }) {
  await requireRole("ADMIN", "MANAGER");
  const { code } = await params;
  const p = await getProperty(code);
  const status = await getSetupStatus(p.id);
  const prog = setupProgress(status);
  const label = p.status === "DRAFT" ? `Draft · ${prog.done} of ${prog.total} steps done` : p.status === "ACTIVE" ? "Open for bookings" : "Archived";
  return (
    <div className="page">
      <div>
        <div className="crumb"><Link href="/settings/properties">Properties</Link> / {p.name}</div>
        <div className="head">
          <div><h1>{p.name}</h1><p>{label} · code {p.code}</p></div>
          {p.status !== "DRAFT" && <div className="actions"><Link className="btn" href={`/p/${p.code}`}>View property</Link></div>}
        </div>
      </div>
      <StepNav code={p.code} status={status} />
      {children}
    </div>
  );
}
