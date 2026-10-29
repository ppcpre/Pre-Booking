export type SetupStatus = {
  room_types: number;
  units: number;
  missing_rates: number;
  needs_utilities: boolean;
  utility_rates: number;
  staff: number;
};

export const SETUP_STEPS = [
  { key: "details", label: "Details", optional: false },
  { key: "rooms", label: "Room types", optional: false },
  { key: "units", label: "Units", optional: false },
  { key: "rates", label: "Rates", optional: false },
  { key: "meters", label: "Water & electricity", optional: true },
  { key: "staff", label: "Staff", optional: true },
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

/** Not needed to open, but worth doing later. */
export function setupReminders(s: SetupStatus): string[] {
  const out: string[] = [];
  if (s.needs_utilities && s.utility_rates < 2) out.push("Water and electricity prices aren't set yet. Add them before billing yearly tenants for utilities.");
  return out;
}

/** What still blocks opening the property for bookings. Empty list = ready. */
export function activationBlockers(s: SetupStatus): string[] {
  const out: string[] = [];
  if (s.room_types === 0) out.push("Add at least one room type");
  if (s.units === 0) out.push("Add units");
  if (s.units > 0 && s.missing_rates > 0) out.push(`Set ${s.missing_rates} missing rate${s.missing_rates > 1 ? "s" : ""}`);
  return out;
}

export function setupProgress(s: SetupStatus): { done: number; total: number } {
  const required = SETUP_STEPS.filter((st) => !st.optional);
  return { done: required.filter((st) => stepDone(st.key, s)).length, total: required.length };
}
