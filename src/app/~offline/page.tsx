import { Logo } from "@/components/logo";

export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <div className="auth-wrap">
      <div className="signin">
        <div className="brand"><Logo />pre-booking</div>
        <div style={{ display: "grid", gap: 6 }}>
          <h1>You&apos;re offline</h1>
          <p>This page hasn&apos;t been opened on this device yet. Reconnect and it will load.</p>
        </div>
      </div>
    </div>
  );
}
