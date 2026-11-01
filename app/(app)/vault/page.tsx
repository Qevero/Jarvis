import { formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { dashboardVault } from "@/lib/vault/dashboard";
import { FIELDS, ITEM_KINDS, ITEM_KIND_LABELS, SECTIONS } from "@/lib/vault/fields";
import { deleteDocumentAction, deleteItemAction } from "./actions";
import { DocumentLink, DocumentUpload, FieldForm, ItemForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const { vault, owner } = await dashboardVault("/vault");
  await vault.seedDefaults();
  const [profile, items, documents] = await Promise.all([vault.getProfile(), vault.listItems(), vault.listDocuments()]);
  const byKey = new Map(profile.map((p) => [p.key, p]));

  return (
    <div className="space-y-5">
      <div>
        <p className="hud-label">Company Vault</p>
        <h1 className="mt-1 text-2xl font-semibold">Qevero&apos;s core records</h1>
        <p className="mt-1 text-sm text-muted">Claude reads these through the Jarvis connector. Sensitive fields are encrypted and masked unless you ask for them in full.</p>
      </div>

      {SECTIONS.map((section) => (
        <section key={section} className="panel px-5 py-3">
          <h2 className="hud-label pt-2">{section}</h2>
          <div className="divide-y divide-line">
            {FIELDS.filter((f) => f.section === section).map((f) => {
              const p = byKey.get(f.key)!;
              return <FieldForm key={f.key} fieldKey={f.key} label={f.label} type={f.type} options={f.options} hint={f.hint} display={p.display} sensitive={p.sensitive} masked={p.masked} />;
            })}
          </div>
        </section>
      ))}

      {ITEM_KINDS.map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        return (
          <section key={kind} className="panel p-5">
            <h2 className="hud-label">{ITEM_KIND_LABELS[kind]}</h2>
            {list.length === 0 ? (
              <p className="mt-3 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {list.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{i.name}</p>
                      <p className="text-xs text-muted">
                        {[i.provider, i.reference, i.renewal_date && `Renews ${formatUkDate(i.renewal_date)}`, i.cost_pence !== null && `${formatGbpFromPence(i.cost_pence)}${i.billing_period ? ` ${i.billing_period}` : ""}`, i.notes]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <form action={deleteItemAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="btn btn-ghost btn-sm text-muted" aria-label={`Remove ${i.name}`}>
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <ItemForm kind={kind} />
          </section>
        );
      })}

      <section className="panel p-5">
        <h2 className="hud-label">Documents</h2>
        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Upload your certificate of incorporation, VAT certificate and insurance schedules.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <DocumentLink id={d.id} name={d.name} />
                  <p className="text-xs text-muted">
                    {d.category} · {d.uploaded}
                    {d.size_kb !== null && ` · ${d.size_kb} KB`}
                  </p>
                </div>
                <form action={deleteDocumentAction}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="btn btn-ghost btn-sm text-muted" aria-label={`Delete ${d.name}`}>
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <DocumentUpload ownerId={owner.id} />
      </section>
    </div>
  );
}
