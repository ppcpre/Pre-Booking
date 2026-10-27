export type SetupStatus = {
  room_types: number;
  units: number;
  missing_rates: number;
  needs_utilities: boolean;
  utility_rates: number;
  staff: number;
};

export const SETUP_STEPS = [
  { key: "details", label: "Details" },
  { key: "rooms", label: "Room types" },
  { key: "units", label: "Units" },
  { key: "rates", label: "Rates" },
  { key: "meters", label: "Meters" },
  { key: "staff", label: "Staff" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

export function stepDone(key: SetupStepKey, s: SetupStatus): boolean {
  switch (key) {
    case "details":
      return true;
    case "rooms":
      return s.room_types > 0;
    case "units":
      return s.units > 0;
    case "rates":
      return s.units > 0 && s.missing_rates === 0;
    case "meters":
      return !s.needs_utilities || s.utility_rates >= 2;
    case "staff":
      return true; // optional: admins can run a property alone
  }
}

/** What still blocks opening the property for bookings. Empty list = ready. */
export function activationBlockers(s: SetupStatus): string[] {
  const out: string[] = [];
  if (s.room_types === 0) out.push("Add at least one room type");
  if (s.units === 0) out.push("Add units");
  if (s.units > 0 && s.missing_rates > 0) out.push(`Set ${s.missing_rates} missing rate${s.missing_rates > 1 ? "s" : ""}`);
  if (s.needs_utilities && s.utility_rates < 2) out.push("Set water and electricity prices for yearly units");
  return out;
}

export function setupProgress(s: SetupStatus): { done: number; total: number } {
  const done = SETUP_STEPS.filter((st) => st.key !== "staff" && stepDone(st.key, s)).length;
  return { done, total: SETUP_STEPS.length - 1 };
}
