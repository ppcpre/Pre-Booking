"use client";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { SETUP_STEPS, stepDone, type SetupStatus } from "@/lib/setup";

export function StepNav({ code, status }: { code: string; status: SetupStatus }) {
  const seg = useSelectedLayoutSegment();
  return (
    <nav className="steps" aria-label="Setup steps">
      {SETUP_STEPS.map((s) => {
        const current = seg === s.key;
        const done = !current && stepDone(s.key, status) && s.key !== "staff";
        return (
          <Link key={s.key} href={`/settings/properties/${code}/${s.key}`} className={done ? "done" : undefined} aria-current={current ? "step" : undefined}>
            {s.label}{s.optional && <small className="dim">optional</small>}
          </Link>
        );
      })}
    </nav>
  );
}
