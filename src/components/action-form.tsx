"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/types";

type Props = {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  footer?: ReactNode;
};

export function SubmitButton({ children, className = "btn primary" }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}

/** A form bound to a Server Action that shows the action's error or success message inline. */
export function ActionForm({ action, children, submitLabel = "Save", className = "card", resetOnSuccess, footer }: Props) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error && <div className="msg err" role="alert">{state.error}</div>}
      {state.ok && state.message && <div className="msg ok" role="status">{state.message}</div>}
      <div className="formfoot">
        <div className="actions">{footer}</div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

/** A one-button form (delete, toggle) with hidden fields and an optional confirmation step. */
export function InlineAction({
  action,
  fields,
  label,
  className = "btn sm quiet",
  confirmText,
}: {
  action: (fd: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: ReactNode;
  className?: string;
  confirmText?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      style={{ display: "inline" }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton className={className}>{label}</SubmitButton>
    </form>
  );
}
