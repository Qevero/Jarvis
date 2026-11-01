"use server";
import { revalidatePath } from "next/cache";
import { dashboardVault } from "@/lib/vault/dashboard";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/vault/fields";
import { VaultError } from "@/lib/vault/service";

export type ActionState = { ok: boolean; message: string } | null;

function errorState(e: unknown): ActionState {
  if (e instanceof VaultError) return { ok: false, message: e.message };
  console.error("[jarvis] vault action failed:", e instanceof Error ? e.message : "unknown");
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function updateFieldAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { vault } = await dashboardVault();
    const result = await vault.updateField(String(form.get("key")), String(form.get("value") ?? ""));
    revalidatePath("/vault");
    revalidatePath("/");
    return { ok: true, message: result.cleared ? "Cleared" : "Saved" };
  } catch (e) {
    return errorState(e);
  }
}

export async function revealFieldAction(key: string): Promise<string | null> {
  const { vault } = await dashboardVault();
  const [field] = await vault.getProfile({ reveal: true, keys: [key] });
  return field?.value ?? null;
}

export async function addItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { vault } = await dashboardVault();
    const cost = String(form.get("cost") ?? "").replace(/[£,\s]/g, "");
    const costPence = cost === "" ? null : Math.round(Number(cost) * 100);
    if (costPence !== null && !Number.isFinite(costPence)) return { ok: false, message: "Cost must be a number, e.g. 49.99." };
    await vault.addItem({
      kind: form.get("kind"),
      name: form.get("name"),
      provider: form.get("provider"),
      reference: form.get("reference"),
      renewal_date: form.get("renewal_date"),
      cost_pence: costPence,
      billing_period: form.get("billing_period"),
      notes: form.get("notes"),
    } as never);
    revalidatePath("/vault");
    revalidatePath("/");
    return { ok: true, message: "Added" };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteItemAction(form: FormData): Promise<void> {
  const { vault } = await dashboardVault();
  await vault.deleteItem(String(form.get("id")));
  revalidatePath("/vault");
  revalidatePath("/");
}

export async function recordDocumentAction(input: { name: string; category: string; storagePath: string; mimeType: string | null; sizeBytes: number | null }): Promise<ActionState> {
  try {
    const { vault, owner } = await dashboardVault();
    if (!DOCUMENT_CATEGORIES.includes(input.category as DocumentCategory)) return { ok: false, message: "Choose a category." };
    await vault.recordDocument(
      { name: input.name, category: input.category as DocumentCategory, storage_path: input.storagePath, mime_type: input.mimeType, size_bytes: input.sizeBytes },
      owner.id,
    );
    revalidatePath("/vault");
    return { ok: true, message: "Uploaded" };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteDocumentAction(form: FormData): Promise<void> {
  const { vault } = await dashboardVault();
  await vault.deleteDocument(String(form.get("id")));
  revalidatePath("/vault");
}

export async function documentLinkAction(id: string): Promise<string | null> {
  const { vault } = await dashboardVault();
  try {
    return (await vault.getDocument(id)).download_url;
  } catch {
    return null;
  }
}
