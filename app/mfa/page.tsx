import { Suspense } from "react";
import { HudMark } from "@/components/hud-mark";
import { MfaForm } from "./mfa-form";

export default function MfaPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <HudMark className="h-14 w-14" />
        <p className="hud-label">Two-factor verification</p>
      </div>
      <Suspense>
        <MfaForm />
      </Suspense>
    </main>
  );
}
