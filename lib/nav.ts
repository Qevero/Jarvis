/** Dashboard navigation (shared by server and client components). */

export type NavItem = { href: string; label: string; icon: string };

export const NAV_ICONS = {
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  revenue: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  invoice: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  proposal: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  work: "M4 6h16v14H4zM8 3v6M16 3v6M4 11h16",
  crm: "M16 11a4 4 0 1 0-8 0M3 21a9 9 0 0 1 18 0M12 7a3 3 0 1 0 0-.01",
  tax: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  journal: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM9 8h6M9 12h6",
  memory: "M12 3a6 6 0 0 0-6 6c0 2 1 3 2 4v3h8v-3c1-1 2-2 2-4a6 6 0 0 0-6-6zM9 20h6",
  clients: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9",
  vault: "M4 5h16v14H4zM4 9h16M9 13h6",
  settings: "M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: NAV_ICONS.home },
  { href: "/revenue", label: "Revenue", icon: NAV_ICONS.revenue },
  { href: "/invoices", label: "Invoices", icon: NAV_ICONS.invoice },
  { href: "/proposals", label: "Proposals", icon: NAV_ICONS.proposal },
  { href: "/work", label: "Work", icon: NAV_ICONS.work },
  { href: "/crm", label: "CRM", icon: NAV_ICONS.crm },
  { href: "/tax", label: "Tax", icon: NAV_ICONS.tax },
  { href: "/journal", label: "Journal", icon: NAV_ICONS.journal },
  { href: "/memory", label: "Memory", icon: NAV_ICONS.memory },
  { href: "/clients", label: "Clients", icon: NAV_ICONS.clients },
  { href: "/vault", label: "Vault", icon: NAV_ICONS.vault },
  { href: "/settings", label: "Settings", icon: NAV_ICONS.settings },
];

