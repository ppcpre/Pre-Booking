import type { ReactNode } from "react";

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const HomeIcon = (p: { className?: string }) => (
  <Icon {...p}><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" /></Icon>
);
export const BuildingIcon = (p: { className?: string }) => (
  <Icon {...p}><path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20M15 10h3.5a1.5 1.5 0 0 1 1.5 1.5V20M3.5 20h17M8.5 8h3M8.5 11.5h3M8.5 15h3" /></Icon>
);
export const CalendarIcon = (p: { className?: string }) => (
  <Icon {...p}><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></Icon>
);
export const ListIcon = (p: { className?: string }) => (
  <Icon {...p}><path d="M6 4.5h12v15H6z" /><path d="M9 9h6M9 12.5h6M9 16h3.5" /></Icon>
);
export const CardIcon = (p: { className?: string }) => (
  <Icon {...p}><rect x="3.5" y="6" width="17" height="12" rx="2.5" /><path d="M3.5 10h17M7 14.5h3" /></Icon>
);
export const BoltIcon = (p: { className?: string }) => (
  <Icon {...p}><path d="M13 3.5 5.5 13H12l-1 7.5L18.5 11H12z" /></Icon>
);
export const DocIcon = (p: { className?: string }) => (
  <Icon {...p}><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4M10 12h5M10 15.5h5" /></Icon>
);
export const UsersIcon = (p: { className?: string }) => (
  <Icon {...p}><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.3a3 3 0 0 1 0 5.6M17.5 14.2a5 5 0 0 1 3 4.8" /></Icon>
);
export const GearIcon = (p: { className?: string }) => (
  <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" /></Icon>
);
export const CameraIcon = (p: { className?: string }) => (
  <Icon {...p}><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3V19H4z" /><circle cx="12" cy="13.5" r="3.4" /></Icon>
);
export const PlusIcon = (p: { className?: string }) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
