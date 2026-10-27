/** Logo B · Doorway: an arched door whose panels are calendar days; the white one is booked. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#ffffff" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.5" fill="none" stroke="#dcf1e7" strokeWidth="1.5" />
      <path d="M17 52V30a15 15 0 0 1 30 0v22z" fill="#2c6a55" />
      <rect x="24" y="31" width="7" height="7" rx="1.8" fill="#a8dbc5" />
      <rect x="33" y="31" width="7" height="7" rx="1.8" fill="#a8dbc5" />
      <rect x="24" y="40" width="7" height="7" rx="1.8" fill="#a8dbc5" />
      <rect x="33" y="40" width="7" height="7" rx="1.8" fill="#ffffff" />
    </svg>
  );
}
