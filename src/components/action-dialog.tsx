"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SubmitButton } from "@/components/action-form";
import type { ActionResult } from "@/lib/types";

type Props = {
  label: ReactNode;
  title: string;
  subtitle?: ReactNode;
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel: string;
  triggerClass?: string;
  submitClass?: string;
  openOnLoad?: boolean;
  /** Adds a fresh idempotency_key each time the dialog opens, so a double tap can't save twice. */
  withKey?: boolean;
};

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** A button that opens a modal form bound to a Server Action. Closes and refreshes the page on success. */
export function ActionDialog({ label, title, subtitle, action, children, submitLabel, triggerClass = "btn", submitClass = "btn primary", openOnLoad, withKey }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  const [key, setKey] = useState(newKey);
  const [round, setRound] = useState(0);

  const open = () => {
    setKey(newKey());
    setRound((r) => r + 1);
    ref.current?.showModal();
  };

  useEffect(() => {
    if (openOnLoad) open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.ok) {
      ref.current?.close();
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <button type="button" className={triggerClass} onClick={open}>{label}</button>
      <dialog ref={ref} className="sheet" aria-labelledby={titleId}>
        <form action={formAction} key={round}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="hint">{subtitle}</div>}
          </div>
          {withKey && <input type="hidden" name="idempotency_key" value={key} />}
          {children}
          {state.error && !state.ok && <div className="msg err" role="alert">{state.error}</div>}
          <div className="formfoot">
            <button type="button" className="btn quiet" onClick={() => ref.current?.close()}>Cancel</button>
            <SubmitButton className={submitClass}>{submitLabel}</SubmitButton>
          </div>
        </form>
      </dialog>
      {state.ok && state.message && <span className="msg ok" role="status">{state.message}</span>}
    </>
  );
}
