import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { HudMark } from "@/components/hud-mark";
import { NavLinks } from "@/components/nav-links";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOwner("/");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))] md:pb-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <HudMark className="h-9 w-9" spin />
          <span className="text-lg font-semibold tracking-[0.3em]">JARVIS</span>
        </Link>
        <nav className="hidden md:block">
          <NavLinks variant="top" />
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <NavLinks variant="bottom" />
      </nav>
    </div>
  );
}
