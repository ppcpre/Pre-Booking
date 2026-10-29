import Link from "next/link";
import { SETUP_STEPS, type SetupStepKey } from "@/lib/setup";

export function NextStep({ code, from }: { code: string; from: SetupStepKey }) {
  const i = SETUP_STEPS.findIndex((s) => s.key === from);
  const next = SETUP_STEPS[i + 1];
  if (!next) return null;
  return <Link className="btn quiet" href={`/settings/properties/${code}/${next.key}`}>Next: {next.label}{next.optional ? " (optional)" : ""} →</Link>;
}
