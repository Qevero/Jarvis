import { randomUUID } from "node:crypto";
import type { AuditRow, DocumentRow, FieldRow, VaultItem, VaultStore } from "@/lib/vault/store";

/** In-memory VaultStore for tests. */
export function memoryStore() {
  const fields = new Map<string, FieldRow>();
  const items = new Map<string, VaultItem>();
  const docs = new Map<string, DocumentRow>();
  const objects = new Set<string>();
  const audit: AuditRow[] = [];
  let auditId = 0;
  const now = () => new Date().toISOString();

  const store: VaultStore = {
    async listFields() {
      return [...fields.values()];
    },
    async upsertField(row) {
      fields.set(row.key, { ...row, updated_at: now() });
    },
    async deleteField(key) {
      fields.delete(key);
    },
    async listItems(kind) {
      return [...items.values()].filter((i) => !kind || i.kind === kind);
    },
    async insertItem(item) {
      const row = { ...item, id: randomUUID(), updated_at: now() };
      items.set(row.id, row);
      return row;
    },
    async updateItem(id, patch) {
      const cur = items.get(id);
      if (!cur) return null;
      const row = { ...cur, ...patch, updated_at: now() };
      items.set(id, row);
      return row;
    },
    async deleteItem(id) {
      return items.delete(id);
    },
    async listDocuments(category) {
      return [...docs.values()].filter((d) => !category || d.category === category);
    },
    async getDocument(id) {
      return docs.get(id) ?? null;
    },
    async insertDocument(doc) {
      const row = { ...doc, id: randomUUID(), uploaded_at: now() };
      docs.set(row.id, row);
      return row;
    },
    async deleteDocument(id) {
      const d = docs.get(id) ?? null;
      docs.delete(id);
      return d;
    },
    async objectExists(path) {
      return objects.has(path);
    },
    async signedUrl(path, exp) {
      return `https://storage.test/${path}?exp=${exp}`;
    },
    async appendAudit(entry) {
      audit.push({ ...entry, id: ++auditId, occurred_at: now() });
    },
    async listAudit(limit) {
      return audit.slice(-limit).reverse();
    },
  };

  return { store, fields, items, docs, objects, audit };
}
