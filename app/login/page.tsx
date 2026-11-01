import { Suspense } from "react";
import { HudMark } from "@/components/hud-mark";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <HudMark className="h-20 w-20" spin />
        <h1 className="text-2xl font-semibold tracking-[0.3em]">JARVIS</h1>
        <p className="hud-label">Qevero · secure sign-in</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
