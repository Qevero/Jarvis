import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentCategory, ItemKind } from "./fields";

/**
 * Storage interface for the Company Vault. The Supabase implementation runs
 * with the caller's own token, so Row Level Security applies to every query.
 * An in-memory implementation lives in tests.
 */

export type FieldRow = { key: string; value: string | null; value_encrypted: string | null; updated_at: string };

export type VaultItem = {
  id: string;
  kind: ItemKind;
  name: string;
  provider: string | null;
  reference: string | null;
  renewal_date: string | null;
  cost_pence: number | null;
  billing_period: string | null;
  notes: string | null;
  updated_at: string;
};

export type VaultItemInput = Omit<VaultItem, "id" | "updated_at">;

export type DocumentRow = {
  id: string;
  name: string;
  category: DocumentCategory;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
};

export type AuditEntry = {
  source: "dashboard" | "mcp" | "system";
  client_id?: string | null;
  action: string;
  target?: string | null;
  details?: Record<string, unknown>;
};

export type AuditRow = AuditEntry & { id: number; occurred_at: string };

export interface VaultStore {
  listFields(): Promise<FieldRow[]>;
  upsertField(row: { key: string; value: string | null; value_encrypted: string | null }): Promise<void>;
  deleteField(key: string): Promise<void>;
  listItems(kind?: ItemKind): Promise<VaultItem[]>;
  insertItem(item: VaultItemInput): Promise<VaultItem>;
  updateItem(id: string, item: Partial<VaultItemInput>): Promise<VaultItem | null>;
  deleteItem(id: string): Promise<boolean>;
  listDocuments(category?: DocumentCategory): Promise<DocumentRow[]>;
  getDocument(id: string): Promise<DocumentRow | null>;
  insertDocument(doc: Omit<DocumentRow, "id" | "uploaded_at">): Promise<DocumentRow>;
  deleteDocument(id: string): Promise<DocumentRow | null>;
  objectExists(storagePath: string): Promise<boolean>;
  signedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;
  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(limit: number): Promise<AuditRow[]>;
}

export const BUCKET = "vault";

function fail(context: string, error: { message: string } | null): never {
  // Error messages from PostgREST never include row values.
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

export function supabaseVaultStore(sb: SupabaseClient): VaultStore {
  return {
    async listFields() {
      const { data, error } = await sb.from("company_fields").select("key, value, value_encrypted, updated_at");
      if (error) fail("Reading company fields", error);
      return data as FieldRow[];
    },
    async upsertField(row) {
      const { error } = await sb.from("company_fields").upsert(row, { onConflict: "owner_id,key" });
      if (error) fail("Saving company field", error);
    },
    async deleteField(key) {
      const { error } = await sb.from("company_fields").delete().eq("key", key);
      if (error) fail("Clearing company field", error);
    },
    async listItems(kind) {
      let q = sb.from("vault_items").select("*").order("kind").order("renewal_date", { ascending: true, nullsFirst: false }).order("name");
      if (kind) q = q.eq("kind", kind);
      const { data, error } = await q;
      if (error) fail("Reading vault items", error);
      return data as VaultItem[];
    },
    async insertItem(item) {
      const { data, error } = await sb.from("vault_items").insert(item).select("*").single();
      if (error) fail("Adding vault item", error);
      return data as VaultItem;
    },
    async updateItem(id, item) {
      const { data, error } = await sb.from("vault_items").update(item).eq("id", id).select("*").maybeSingle();
      if (error) fail("Updating vault item", error);
      return (data as VaultItem) ?? null;
    },
    async deleteItem(id) {
      const { data, error } = await sb.from("vault_items").delete().eq("id", id).select("id");
      if (error) fail("Deleting vault item", error);
      return (data?.length ?? 0) > 0;
    },
    async listDocuments(category) {
      let q = sb.from("documents").select("*").order("uploaded_at", { ascending: false });
      if (category) q = q.eq("category", category);
      const { data, error } = await q;
      if (error) fail("Reading documents", error);
      return data as DocumentRow[];
    },
    async getDocument(id) {
      const { data, error } = await sb.from("documents").select("*").eq("id", id).maybeSingle();
      if (error) fail("Reading document", error);
      return (data as DocumentRow) ?? null;
    },
    async insertDocument(doc) {
      const { data, error } = await sb.from("documents").insert(doc).select("*").single();
      if (error) fail("Recording document", error);
      return data as DocumentRow;
    },
    async deleteDocument(id) {
      const { data, error } = await sb.from("documents").delete().eq("id", id).select("*").maybeSingle();
      if (error) fail("Deleting document", error);
      if (data) {
        const { error: rmError } = await sb.storage.from(BUCKET).remove([(data as DocumentRow).storage_path]);
        if (rmError) fail("Deleting stored file", rmError);
      }
      return (data as DocumentRow) ?? null;
    },
    async objectExists(storagePath) {
      const { data, error } = await sb.storage.from(BUCKET).exists(storagePath);
      if (error) return false;
      return Boolean(data);
    },
    async signedUrl(storagePath, expiresInSeconds) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
      if (error || !data) fail("Creating download link", error);
      return data.signedUrl;
    },
    async appendAudit(entry) {
      const { error } = await sb.from("audit_log").insert({
        source: entry.source,
        client_id: entry.client_id ?? null,
        action: entry.action,
        target: entry.target ?? null,
        details: entry.details ?? {},
      });
      if (error) fail("Writing audit log", error);
    },
    async listAudit(limit) {
      const { data, error } = await sb.from("audit_log").select("id, occurred_at, source, client_id, action, target, details").order("occurred_at", { ascending: false }).limit(limit);
      if (error) fail("Reading audit log", error);
      return data as AuditRow[];
    },
  };
}
