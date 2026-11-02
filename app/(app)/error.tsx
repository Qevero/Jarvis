"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="panel mx-auto mt-10 max-w-md p-6 text-center">
      <p className="text-3xl" aria-hidden="true">🛰️</p>
      <h1 className="mt-2 text-lg font-semibold">Jarvis hit a snag</h1>
      <p className="mt-1 text-sm text-muted">Something didn&apos;t load — usually a connection blip or an integration that needs reconnecting.</p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={reset} className="btn btn-primary btn-sm">Try again</button>
        <a href="/setup" className="btn btn-ghost btn-sm">Check setup</a>
      </div>
    </div>
  );
}
