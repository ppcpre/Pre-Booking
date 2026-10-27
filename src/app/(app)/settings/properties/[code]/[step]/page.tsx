import { notFound } from "next/navigation";
import { getProperty } from "@/lib/properties";
import { SETUP_STEPS, type SetupStepKey } from "@/lib/setup";
import { DetailsStep } from "../../steps/details-step";
import { RoomsStep } from "../../steps/rooms-step";
import { UnitsStep } from "../../steps/units-step";
import { RatesStep } from "../../steps/rates-step";
import { MetersStep } from "../../steps/meters-step";
import { StaffStep } from "../../steps/staff-step";

const STEP_COMPONENTS: Record<SetupStepKey, (p: { propertyCode: string }) => Promise<React.ReactNode>> = {
  details: DetailsStep,
  rooms: RoomsStep,
  units: UnitsStep,
  rates: RatesStep,
  meters: MetersStep,
  staff: StaffStep,
};

export default async function StepPage({ params }: { params: Promise<{ code: string; step: string }> }) {
  const { code, step } = await params;
  if (!SETUP_STEPS.some((s) => s.key === step)) notFound();
  await getProperty(code); // 404 when the property doesn't exist or isn't visible
  const Step = STEP_COMPONENTS[step as SetupStepKey];
  return <Step propertyCode={code} />;
}
