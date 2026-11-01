"use client";
import { useRef, useState } from "react";
import { useBrowserCheck } from "@/components/forms";
import { saveJournalAction } from "@/app/(app)/actions";

/** Browser speech (free, built in): read text aloud, and dictate quick notes. */

export function SpeakButton({ text, label = "Read aloud" }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const supported = useBrowserCheck(() => "speechSynthesis" in window);
  if (!supported) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        const synth = window.speechSynthesis;
        if (speaking) {
          synth.cancel();
          setSpeaking(false);
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-GB";
        const voice = synth.getVoices().find((v) => v.lang === "en-GB" && /daniel|arthur|male/i.test(v.name)) ?? synth.getVoices().find((v) => v.lang === "en-GB");
        if (voice) u.voice = voice;
        u.rate = 1.02;
        u.onend = () => setSpeaking(false);
        setSpeaking(true);
        synth.speak(u);
      }}
    >
      {speaking ? "■ Stop" : `🔊 ${label}`}
    </button>
  );
}

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void };

export function QuickNote() {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const supported = useBrowserCheck(() => "SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-GB";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let add = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript;
      if (add) setText((t) => (t ? `${t} ${add.trim()}` : add.trim()));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  async function save() {
    if (!text.trim()) return;
    const fd = new FormData();
    fd.set("raw_notes", text);
    fd.set("title", text.slice(0, 60));
    fd.set("source", "voice");
    const r = await saveJournalAction(null, fd);
    setStatus(r?.message ?? null);
    if (r?.ok) setText("");
  }

  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot a thought… (structure it later in Claude: “tidy up my latest journal note”)" className="input" rows={3} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {supported && (
          <button type="button" onClick={toggle} className={`btn btn-sm ${listening ? "btn-primary" : "btn-ghost"}`} aria-pressed={listening}>
            {listening ? "● Listening… tap to stop" : "🎙 Dictate"}
          </button>
        )}
        <button type="button" onClick={save} disabled={!text.trim()} className="btn btn-ghost btn-sm">Save to journal</button>
        {status && <span className="text-sm text-ok">{status}</span>}
      </div>
    </div>
  );
}
