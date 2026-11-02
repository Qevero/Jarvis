/** Dashboard navigation (shared by server and client components). */

export type NavItem = { href: string; label: string; icon: string; hint?: string };

export const NAV_ICONS = {
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  business: "M3 7h18v13H3zM8 7V4h8v3M3 12h18",
  life: "M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z",
  inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
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
  health: "M3 12h4l2-5 4 10 2-5h6",
  messages: "M4 5h16v11H8l-4 4z",
  review: "M4 4h16v16H4zM8 15l3-3 2 2 4-5",
  setup: "M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "", items: [{ href: "/", label: "Today", icon: NAV_ICONS.home }, { href: "/inbox", label: "Inbox", icon: NAV_ICONS.inbox }] },
  {
    title: "Business",
    items: [
      { href: "/business", label: "Overview", icon: NAV_ICONS.business },
      { href: "/revenue", label: "Revenue", icon: NAV_ICONS.revenue, hint: "Streams, clients, debtors" },
      { href: "/invoices", label: "Invoices", icon: NAV_ICONS.invoice, hint: "Invoices, quotes, POs" },
      { href: "/proposals", label: "Proposals", icon: NAV_ICONS.proposal, hint: "Write, print, win" },
      { href: "/crm", label: "CRM", icon: NAV_ICONS.crm, hint: "Pipeline and tenders" },
      { href: "/clients", label: "Clients", icon: NAV_ICONS.clients, hint: "Retainers and links" },
      { href: "/tax", label: "Tax", icon: NAV_ICONS.tax, hint: "Deadlines, VAT, set-aside" },
      { href: "/vault", label: "Vault", icon: NAV_ICONS.vault, hint: "Company details and documents" },
    ],
  },
  {
    title: "Life",
    items: [
      { href: "/life", label: "Overview", icon: NAV_ICONS.life },
      { href: "/work", label: "Tasks & calendar", icon: NAV_ICONS.work, hint: "To Do, diary, email" },
      { href: "/health", label: "Health", icon: NAV_ICONS.health, hint: "Food, weight, training" },
      { href: "/messages", label: "Messages", icon: NAV_ICONS.messages, hint: "What you've missed" },
      { href: "/journal", label: "Journal", icon: NAV_ICONS.journal, hint: "Thoughts and ideas" },
      { href: "/memory", label: "Memory", icon: NAV_ICONS.memory, hint: "What Jarvis knows" },
      { href: "/review", label: "Weekly review", icon: NAV_ICONS.review, hint: "Your week at a glance" },
    ],
  },
  { title: "Jarvis", items: [{ href: "/setup", label: "Setup", icon: NAV_ICONS.setup }, { href: "/settings", label: "Settings", icon: NAV_ICONS.settings }] },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => (i.label === "Overview" ? { ...i, label: `${g.title} overview` } : i)));
