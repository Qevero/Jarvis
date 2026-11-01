"use client";
import { useState } from "react";
import { unzipSync, strFromU8 } from "fflate";
import { batchConversations, parseClaudeExport } from "@/lib/knowledge/claude-export";

/**
 * Imports Claude's data export. The zip (or conversations.json) is read in
 * the browser; only message text is uploaded, in batches.
 */
export function ChatImporter() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function onFile(file: File) {
    setBusy(true);
    setProgress(0);
    setStatus("Reading the export…");
    try {
      let json: unknown;
      const buf = new Uint8Array(await file.arrayBuffer());
      if (file.name.toLowerCase().endsWith(".zip")) {
        const files = unzipSync(buf, { filter: (f) => /(^|\/)conversations\.json$/i.test(f.name) });
        const entry = Object.values(files)[0];
        if (!entry) throw new Error("No conversations.json inside that zip.");
        json = JSON.parse(strFromU8(entry));
      } else {
        json = JSON.parse(strFromU8(buf));
      }
      const convs = parseClaudeExport(json);
      if (!convs.length) throw new Error("No conversations with text found.");
      const batches = batchConversations(convs, 1_500_000);
      let done = 0, messages = 0;
      for (const b of batches) {
        const res = await fetch("/api/knowledge/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversations: b }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Import failed");
        done += body.conversations;
        messages += body.messages;
        setProgress(Math.round((done / convs.length) * 100));
        setStatus(`Imported ${done} of ${convs.length} conversations…`);
      }
      setStatus(`Done: ${done} conversations, ${messages} messages. Re-importing later only adds what's new.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className={`btn btn-primary btn-sm ${busy ? "pointer-events-none opacity-50" : ""}`}>
        {busy ? "Importing…" : "Choose export (.zip or conversations.json)"}
        <input type="file" accept=".zip,.json,application/zip,application/json" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {busy && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-elev"><div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div>}
      {status && <p className="mt-2 text-sm text-muted">{status}</p>}
    </div>
  );
}
