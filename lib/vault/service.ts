import { decrypt, encrypt, mask } from "@/lib/crypto";
import { formatGbpFromPence, formatUkDate, formatUkDateTime, parseDate } from "@/lib/dates";
import { BILLING_PERIODS, FIELDS, ITEM_KINDS, getField, validateFieldValue, type DocumentCategory, type ItemKind, type VaultField } from "./fields";
import type { AuditEntry, DocumentRow, VaultItem, VaultItemInput, VaultStore } from "./store";

/**
 * Company Vault business logic, shared by the dashboard (server actions) and
 * the MCP tools. Sensitive values are encrypted before storage, masked on
 * read, and never written to logs or the audit trail.
 */

export type Actor = { source: AuditEntry["source"]; clientId?: string | null };

export type ProfileField = {
  key: string;
  label: string;
  section: string;
  value: string | null;
  /** Display value: UK date formats, masked if sensitive and not revealed. */
  display: string | null;
  sensitive: boolean;
  masked: boolean;
  updated: string | null;
};

export class VaultError extends Error {}

/** Internal marker row (not a user-facing field). */
export const SEED_MARKER = "vault_seeded_at";

export function createVaultService(store: VaultStore, opts: { key: string; actor: Actor }) {
  const { key, actor } = opts;

  const audit = (action: string, target: string | null, details: Record<string, unknown> = {}) =>
    store.appendAudit({ source: actor.source, client_id: actor.clientId ?? null, action, target, details });

  function displayFor(field: VaultField, value: string | null): string | null {
    if (value === null) return null;
    return field.type === "date" ? formatUkDate(value) : value;
  }

  async function getProfile(options: { reveal?: boolean; keys?: string[] } = {}): Promise<ProfileField[]> {
    const rows = await store.listFields();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const wanted = options.keys?.length ? FIELDS.filter((f) => options.keys!.includes(f.key)) : FIELDS;
    const revealed: string[] = [];

    const result = wanted.map((field) => {
      const row = byKey.get(field.key);
      let value: string | null = null;
      if (row?.value_encrypted) value = decrypt(row.value_encrypted, key);
      else if (row?.value) value = row.value;

      const shouldMask = Boolean(field.sensitive && value !== null && !options.reveal);
      if (field.sensitive && value !== null && options.reveal) revealed.push(field.key);

      return {
        key: field.key,
        label: field.label,
        section: field.section,
        value: shouldMask ? null : value,
        display: shouldMask ? mask(value!) : displayFor(field, value),
        sensitive: Boolean(field.sensitive),
        masked: shouldMask,
        updated: row ? formatUkDateTime(row.updated_at) : null,
      };
    });

    if (revealed.length) await audit("vault.reveal_sensitive", revealed.join(","));
    return result;
  }

  async function updateField(fieldKey: string, rawValue: string) {
    const field = getField(fieldKey);
    if (!field) throw new VaultError(`Unknown field "${fieldKey}". Valid fields: ${FIELDS.map((f) => f.key).join(", ")}.`);
    const result = validateFieldValue(field, rawValue);
    if (!result.ok) throw new VaultError(`${field.label}: ${result.error}`);

    if (result.value === null) {
      await store.deleteField(field.key);
    } else if (field.sensitive) {
      await store.upsertField({ key: field.key, value: null, value_encrypted: encrypt(result.value, key) });
    } else {
      await store.upsertField({ key: field.key, value: result.value, value_encrypted: null });
    }

    // The audit trail records the new value only for non-sensitive fields.
    await audit(result.value === null ? "vault.clear_field" : "vault.update_field", field.key, field.sensitive ? { sensitive: true } : { value: result.value });

    return {
      key: field.key,
      label: field.label,
      cleared: result.value === null,
      display: result.value === null ? null : field.sensitive ? mask(result.value) : displayFor(field, result.value),
    };
  }

  /**
   * Apply seed defaults (Qevero Ltd, incorporation date, …) to empty fields.
   * Runs once: a marker row stops cleared fields from being re-seeded.
   */
  async function seedDefaults(): Promise<string[]> {
    const rows = await store.listFields();
    const existing = new Set(rows.map((r) => r.key));
    if (existing.has(SEED_MARKER)) return [];
    const seeded: string[] = [];
    for (const field of FIELDS) {
      if (field.seed && !existing.has(field.key)) {
        await store.upsertField({ key: field.key, value: field.seed, value_encrypted: null });
        seeded.push(field.key);
      }
    }
    await store.upsertField({ key: SEED_MARKER, value: new Date().toISOString(), value_encrypted: null });
    if (seeded.length) await audit("vault.seed_defaults", null, { fields: seeded });
    return seeded;
  }

  function normaliseItem(input: Partial<Record<keyof VaultItemInput, unknown>>): Partial<VaultItemInput> {
    const out: Partial<VaultItemInput> = {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
    if (input.kind !== undefined) {
      if (!ITEM_KINDS.includes(input.kind as ItemKind)) throw new VaultError(`Item kind must be one of ${ITEM_KINDS.join(", ")}.`);
      out.kind = input.kind as ItemKind;
    }
    if (input.name !== undefined) {
      const name = str(input.name);
      if (!name) throw new VaultError("Name is required.");
      out.name = name.slice(0, 200);
    }
    for (const k of ["provider", "reference", "notes"] as const) {
      if (input[k] !== undefined) out[k] = str(input[k]);
    }
    if (input.renewal_date !== undefined) {
      const raw = str(input.renewal_date);
      if (raw === null) out.renewal_date = null;
      else {
        const iso = parseDate(raw);
        if (!iso) throw new VaultError("Renewal date must be DD/MM/YYYY.");
        out.renewal_date = iso;
      }
    }
    if (input.cost_pence !== undefined) {
      const v = input.cost_pence;
      if (v === null || v === "") out.cost_pence = null;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) throw new VaultError("Cost must be a whole number of pence.");
        out.cost_pence = n;
      }
    }
    if (input.billing_period !== undefined) {
      const bp = str(input.billing_period);
      if (bp !== null && !BILLING_PERIODS.includes(bp as (typeof BILLING_PERIODS)[number])) throw new VaultError(`Billing period must be one of ${BILLING_PERIODS.join(", ")}.`);
      out.billing_period = bp;
    }
    return out;
  }

  function presentItem(item: VaultItem) {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      provider: item.provider,
      reference: item.reference,
      renewal_date: item.renewal_date ? formatUkDate(item.renewal_date) : null,
      cost: item.cost_pence !== null ? formatGbpFromPence(item.cost_pence) : null,
      billing_period: item.billing_period,
      notes: item.notes,
    };
  }

  async function listItems(kind?: ItemKind) {
    return store.listItems(kind);
  }

  async function addItem(input: Partial<Record<keyof VaultItemInput, unknown>>) {
    const n = normaliseItem(input);
    if (!n.kind || !n.name) throw new VaultError("Kind and name are required.");
    const item = await store.insertItem({
      kind: n.kind,
      name: n.name,
      provider: n.provider ?? null,
      reference: n.reference ?? null,
      renewal_date: n.renewal_date ?? null,
      cost_pence: n.cost_pence ?? null,
      billing_period: n.billing_period ?? null,
      notes: n.notes ?? null,
    });
    await audit("vault.add_item", item.id, { kind: item.kind, name: item.name });
    return item;
  }

  async function updateItem(id: string, input: Partial<Record<keyof VaultItemInput, unknown>>) {
    const n = normaliseItem(input);
    const item = await store.updateItem(id, n);
    if (!item) throw new VaultError("Item not found.");
    await audit("vault.update_item", id, { kind: item.kind, name: item.name, fields: Object.keys(n) });
    return item;
  }

  async function deleteItem(id: string) {
    const ok = await store.deleteItem(id);
    if (!ok) throw new VaultError("Item not found.");
    await audit("vault.delete_item", id);
  }

  function presentDocument(doc: DocumentRow) {
    return {
      id: doc.id,
      name: doc.name,
      category: doc.category,
      mime_type: doc.mime_type,
      size_kb: doc.size_bytes !== null ? Math.round(doc.size_bytes / 1024) : null,
      uploaded: formatUkDate(doc.uploaded_at),
    };
  }

  async function listDocuments(category?: DocumentCategory) {
    return (await store.listDocuments(category)).map(presentDocument);
  }

  /** Document metadata plus a short-lived download link (10 minutes). */
  async function getDocument(id: string) {
    const doc = await store.getDocument(id);
    if (!doc) throw new VaultError("Document not found.");
    const url = await store.signedUrl(doc.storage_path, 600);
    await audit("vault.document_link", doc.id, { name: doc.name });
    return { ...presentDocument(doc), download_url: url, link_expires_in_minutes: 10 };
  }

  async function recordDocument(input: { name: string; category: DocumentCategory; storage_path: string; mime_type: string | null; size_bytes: number | null }, ownerId: string) {
    if (!input.storage_path.startsWith(`${ownerId}/`)) throw new VaultError("Invalid storage path.");
    if (!(await store.objectExists(input.storage_path))) throw new VaultError("Upload not found in storage.");
    const doc = await store.insertDocument({ ...input, name: input.name.slice(0, 200) });
    await audit("vault.upload_document", doc.id, { name: doc.name, category: doc.category });
    return doc;
  }

  async function deleteDocument(id: string) {
    const doc = await store.deleteDocument(id);
    if (!doc) throw new VaultError("Document not found.");
    await audit("vault.delete_document", id, { name: doc.name });
  }

  return {
    getProfile,
    updateField,
    seedDefaults,
    listItems,
    presentItem,
    addItem,
    updateItem,
    deleteItem,
    listDocuments,
    getDocument,
    recordDocument,
    deleteDocument,
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
