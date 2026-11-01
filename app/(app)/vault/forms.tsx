"use client";
import { useActionState, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { BILLING_PERIODS, DOCUMENT_CATEGORIES, type ItemKind } from "@/lib/vault/fields";
import { addItemAction, documentLinkAction, recordDocumentAction, revealFieldAction, updateFieldAction, type ActionState } from "./actions";

type FieldProps = {
  fieldKey: string;
  label: string;
  type: string;
  options?: readonly string[];
  hint?: string;
  display: string | null;
  sensitive: boolean;
  masked: boolean;
};

function Status({ state }: { state: ActionState }) {
  if (!state) return null;
  return <span className={`text-xs ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</span>;
}

export function FieldForm(props: FieldProps) {
  const [state, action, pending] = useActionState(updateFieldAction, null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const defaultValue = props.sensitive ? "" : (props.display ?? "");

  async function reveal() {
    setRevealed(revealed ? null : await revealFieldAction(props.fieldKey));
  }

  return (
    <form action={action} className="grid gap-2 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start sm:gap-4">
      <input type="hidden" name="key" value={props.fieldKey} />
      <label htmlFor={`f-${props.fieldKey}`} className="pt-0 text-sm font-medium sm:pt-3.5">
        {props.label}
        {props.sensitive && <span className="badge ml-2">Encrypted</span>}
      </label>
      <div className="space-y-1">
        {props.sensitive && props.display && (
          <div className="flex items-center gap-2 font-mono text-sm">
            <span>{revealed ?? props.display}</span>
            <button type="button" onClick={reveal} className="text-xs text-accent underline-offset-2 hover:underline">
              {revealed ? "Hide" : "Reveal"}
            </button>
          </div>
        )}
        {props.type === "enum" ? (
          <select id={`f-${props.fieldKey}`} name="value" defaultValue={defaultValue} className="input">
            <option value="">— Not set —</option>
            {props.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : props.type === "longtext" ? (
          <textarea id={`f-${props.fieldKey}`} name="value" defaultValue={defaultValue} className="input" rows={3} />
        ) : (
          <input
            id={`f-${props.fieldKey}`}
            name="value"
            defaultValue={defaultValue}
            placeholder={props.sensitive && props.display ? "Enter a new value to replace" : props.type === "date" ? "DD/MM/YYYY" : props.hint}
            className="input"
            type={props.type === "email" ? "email" : "text"}
            inputMode={props.type === "date" || props.type === "daymonth" ? "numeric" : undefined}
            autoComplete="off"
          />
        )}
        {props.hint && <p className="text-xs text-muted">{props.hint}</p>}
      </div>
      <div className="flex items-center gap-2 sm:pt-0">
        <button className="btn btn-ghost btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ItemForm({ kind }: { kind: ItemKind }) {
  const [state, action, pending] = useActionState(addItemAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const isDirector = kind === "director";

  return (
    <details className="mt-3">
      <summary className="btn btn-ghost btn-sm cursor-pointer list-none">+ Add</summary>
      <form
        ref={formRef}
        action={async (fd) => {
          await action(fd);
          formRef.current?.reset();
        }}
        className="mt-3 grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="kind" value={kind} />
        <input name="name" required placeholder={isDirector ? "Full name" : "Name"} className="input" />
        {!isDirector && <input name="provider" placeholder="Provider" className="input" />}
        <input name="reference" placeholder={isDirector ? "Appointed (DD/MM/YYYY) or role" : "Policy / account reference"} className="input" />
        {!isDirector && (
          <>
            <input name="renewal_date" placeholder="Renewal date DD/MM/YYYY" inputMode="numeric" className="input" />
            <input name="cost" placeholder="Cost £" inputMode="decimal" className="input" />
            <select name="billing_period" className="input" defaultValue="">
              <option value="">Billing period</option>
              {BILLING_PERIODS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </>
        )}
        <input name="notes" placeholder="Notes" className="input sm:col-span-2" />
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </button>
          <Status state={state} />
        </div>
      </form>
    </details>
  );
}

export function DocumentUpload({ ownerId }: { ownerId: string }) {
  const [state, setState] = useState<ActionState>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File | null;
    const category = String(fd.get("category"));
    if (!file || file.size === 0) return setState({ ok: false, message: "Choose a file." });
    if (file.size > 10 * 1024 * 1024) return setState({ ok: false, message: "Files must be 10 MB or smaller." });
    setBusy(true);
    setState(null);
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
    const path = `${ownerId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabaseBrowser().storage.from("vault").upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) {
      setBusy(false);
      return setState({ ok: false, message: "Upload failed. Please try again." });
    }
    const result = await recordDocumentAction({ name: file.name, category, storagePath: path, mimeType: file.type || null, sizeBytes: file.size });
    setBusy(false);
    setState(result);
    if (result?.ok) formRef.current?.reset();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-center">
      <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" className="input py-2.5 file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[#031018]" />
      <select name="category" defaultValue="other" className="input">
        {DOCUMENT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c[0].toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
      <button className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Uploading…" : "Upload"}
      </button>
      <div className="sm:col-span-3">
        <Status state={state} />
      </div>
    </form>
  );
}

export function DocumentLink({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-left text-sm text-accent underline-offset-2 hover:underline disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const url = await documentLinkAction(id);
        setBusy(false);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }}
    >
      {name}
    </button>
  );
}
