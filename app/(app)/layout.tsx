import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { HudMark } from "@/components/hud-mark";
import { BottomNav, SideNav } from "@/components/nav-links";
import { CommandPalette } from "@/components/command-palette";
import { MobileSearchButton } from "@/components/mobile-search-button";
import { inboxCount } from "@/lib/services/labs";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { owner, supabase } = await requireOwner("/");
  const count = await inboxCount({ sb: supabase, ownerId: owner.id, actor: { source: "dashboard" } }).catch(() => 0);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[90rem]">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line px-3 py-5 md:flex">
        <Link href="/" className="mb-5 flex items-center gap-3 px-2">
          <HudMark className="h-9 w-9" spin />
          <span className="text-lg font-semibold tracking-[0.28em]">JARVIS</span>
        </Link>
        <nav className="flex-1 overflow-y-auto pb-4" aria-label="Main">
          <SideNav inboxCount={count} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))] md:px-10 md:pb-12 md:pt-8">
        <header className="mb-5 flex items-center justify-between md:hidden">
          <Link href="/" className="flex items-center gap-2.5">
            <HudMark className="h-8 w-8" spin />
            <span className="font-semibold tracking-[0.28em]">JARVIS</span>
          </Link>
          <MobileSearchButton />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Main">
        <BottomNav inboxCount={count} />
      </nav>
      <CommandPalette />
    </div>
  );
}
