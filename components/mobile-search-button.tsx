"use client";
import Link from "next/link";
import { NAV_ICONS } from "@/lib/nav";
import { openPalette } from "@/components/command-palette";
import { Icon } from "@/components/nav-links";

export function MobileSearchButton() {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={openPalette} aria-label="Search" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-fg"><Icon d={NAV_ICONS.search} /></button>
      <Link href="/settings" aria-label="Settings" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-fg"><Icon d={NAV_ICONS.settings} /></Link>
    </div>
  );
}
