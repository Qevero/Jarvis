import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { HudMark } from "@/components/hud-mark";
import { NavLinks } from "@/components/nav-links";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOwner("/");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line px-3 py-5 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-3 px-2">
          <HudMark className="h-9 w-9" spin />
          <span className="text-lg font-semibold tracking-[0.3em]">JARVIS</span>
        </Link>
        <nav className="flex-1 overflow-y-auto">
          <NavLinks variant="side" />
        </nav>
        <p className="hud-label px-2 pt-4">Qevero Ltd</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))] md:px-8 md:pb-10 md:pt-6">
        <header className="mb-5 flex items-center gap-3 md:hidden">
          <HudMark className="h-8 w-8" spin />
          <span className="font-semibold tracking-[0.3em]">JARVIS</span>
        </header>
        <main className="flex-1">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <NavLinks variant="bottom" />
      </nav>
    </div>
  );
}
