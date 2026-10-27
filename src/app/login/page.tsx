import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { GoogleIcon } from "@/components/icons";
import { SubmitButton } from "@/components/action-form";
import { getMember } from "@/lib/session";
import { safeNext } from "@/lib/safe-next";
import { signInWithGoogle } from "./actions";
import { ClearCacheOnSignOut } from "./clear-cache";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  not_on_team: "This Google account isn't on the team. Ask your admin to add it, or use another account.",
  google_unavailable: "Google sign-in isn't available right now. Try again in a moment.",
  callback: "Sign-in didn't finish. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (!sp.error && (await getMember())) redirect(next);
  const error = sp.error ? ERRORS[sp.error] ?? ERRORS.callback : null;

  return (
    <div className="auth-wrap">
      {sp.signed_out && <ClearCacheOnSignOut />}
      <form className="signin" action={signInWithGoogle}>
        <div className="brand"><Logo />pre-booking</div>
        <div style={{ display: "grid", gap: 6 }}>
          <h1>Sign in</h1>
          <p>Use the Google account your admin added to the team.</p>
        </div>
        {error && <div className="msg err" role="alert">{error}</div>}
        {sp.signed_out && !error && <div className="msg ok" role="status">You&apos;re signed out.</div>}
        <input type="hidden" name="next" value={next} />
        <SubmitButton className="gbtn"><GoogleIcon />Continue with Google</SubmitButton>
        <div className="fine">Only team members can sign in. If you see “not on the team”, ask your admin to add your Gmail address.</div>
      </form>
    </div>
  );
}
