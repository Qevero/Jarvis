# Jarvis — Build Brief for Claude Code

**Owner:** Jasper Sayer, Managing Director, Qevero Ltd (qevero.com), Norfolk, UK
**Purpose:** A personal "Jarvis"-style business assistant for running Qevero: voice-first, available on iPhone and desktop.
**How to use this brief:** This file is the repo's `CLAUDE.md`. Build in the phases below and stop for review at the end of each phase.

## 1. Hard constraint: zero AI API cost

Jarvis must not call the Claude API (or any paid LLM API). Do not create or use an `ANTHROPIC_API_KEY`. Do not route requests through a Claude subscription login or OAuth token inside the app.

How Jarvis gets its intelligence instead:

- **Brain and voice:** the official Claude apps (iPhone and desktop), running on Jasper's existing Claude subscription. Use voice mode for spoken conversation.
- **Jarvis itself:** two things we build.
  1. **Jarvis MCP server.** A remote MCP server, added to Claude as a custom connector. It exposes Qevero's data and actions as tools: revenue, journal, tasks, company data, tax deadlines. This is how Claude "becomes" Jarvis.
  2. **Jarvis dashboard.** An installable PWA for iPhone and desktop. It shows revenue analytics, tasks, deadlines and the journal visually. All analytics are calculated in code (deterministic maths, no AI).
- **Recommendations:** anything needing judgement ("how do I grow revenue?", "what needs attention?") is asked in the Claude app. Claude pulls the numbers through the MCP tools and reasons over them.

Other running costs must also be £0:

- Use free tiers only: Netlify, Supabase (or Netlify DB), the Xero Developer Starter tier, and the Microsoft Graph / Azure app registration.
- Use no paid voice services. Any in-dashboard speech uses the browser's built-in Web Speech API.
- If any feature would need a paid service, stop and ask before adding it.

## 2. Devices and voice

- **iPhone:** iOS does not allow background "Hey Jarvis" listening. Provide:
  - A Siri Shortcut named "Jarvis" that opens the Claude app (and the Jarvis dashboard as a second shortcut).
  - Setup instructions for mapping it to the Action Button.
  - A check of whether the Claude iOS app exposes a Shortcuts action that starts voice mode directly, and use it if so.
- **Desktop:** the Claude desktop app with the Jarvis connector enabled. Optional stretch goal: a lightweight local wake-word listener using openWakeWord's free "hey jarvis" model that brings the Claude app forward. Build this only if it's achievable without paid components.
- **Dashboard PWA:** must install to the iPhone home screen and work well at phone width. Large touch targets, dark mode, a fast load.

## 3. Tech stack (suggested; propose alternatives if clearly better)

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind, built as a PWA (manifest, service worker, icons).
- **Hosting:** Netlify. The MCP server runs as Netlify Functions (Streamable HTTP transport) or a separate small service on a free tier.
- **Database, auth and file storage:** Supabase free tier (Postgres with Row Level Security, Auth, Storage).
- **MCP server:** the official MCP TypeScript SDK. It must use proper OAuth per the MCP authorisation spec so it can be added as a custom connector in Claude. Never deploy an unauthenticated MCP server, because this holds financial and tax data.
- **Integrations:**
  - **Xero:** OAuth 2.0 web app on the free Starter tier (one organisation; note the Starter tier's daily call limit and its lack of the Journals endpoint).
  - **Microsoft Graph:** Outlook mail (read and draft), calendar, Microsoft To Do.
- **Design:** clean, dark, "heads-up display" feel inspired by Iron Man's Jarvis, but original, with no Marvel assets, logos or names beyond "Jarvis". Qevero branding where sensible.

## 4. Modules and requirements

### 4.1 Company data store ("Company Vault")

Stores Qevero's core information for Jarvis to reference:

- Legal name, company number, incorporation date (3 October 2026) and registered office
- VAT number and VAT registration date (effective 3 October 2026)
- Corporation tax UTR, accounting year end, directors
- Insurance policies and renewal dates, key suppliers and subscriptions with renewal dates
- Uploaded documents (certificate of incorporation, VAT certificate, insurance schedules) in Supabase Storage
- Sensitive fields (UTR, bank details if added) encrypted at rest. Never logged. Never returned in full by MCP tools unless explicitly requested.

MCP tools: `get_company_profile`, `update_company_field`, `list_documents`, `get_document`

### 4.2 Thought journal

Jasper talks freely to Claude about the business. Claude saves a structured entry through the MCP tool.

- Entry fields: date, title, raw notes, summary, themes or tags, decisions, ideas, action items, linked clients
- Action items can be pushed to the to-do list (with confirmation)
- Dashboard view: searchable timeline and filter by theme or client
- "Turn into blog draft" export (markdown) for qevero.com

MCP tools: `save_journal_entry`, `search_journal`, `get_journal_entry`, `list_recent_journal`, `journal_themes_over_time`

### 4.3 Revenue streams and analytics

- **Source:** Xero (invoices, payments, contacts), synced into Supabase on a schedule (free Netlify scheduled function), plus an on-demand refresh. Stay within Starter tier limits.
- **Revenue streams:** Website Builds, SEO/GEO Retainers, Paid Media, Software & Hosting, Creative/Content. These map from a Xero tracking category "Revenue Stream" on invoice lines. Provide a mapping screen for any untagged lines, with account-code mapping as a fallback.
- **Dashboard metrics, all computed in code:**
  - Revenue by stream (month, quarter, year to date)
  - Monthly recurring vs one-off revenue
  - Growth trends
  - Top clients and client concentration risk (% of revenue from the top 1 and top 3 clients)
  - Average deal size per stream
  - Aged debtors and late payers
  - Pipeline, if added later
- **"Needs attention" flags** from simple rules: a stream down more than X% vs the trailing average, overdue invoices, concentration above a threshold, a retainer not invoiced this month.

MCP tools: `get_revenue_summary(period)`, `get_revenue_by_stream(period)`, `get_client_breakdown`, `get_aged_debtors`, `get_attention_flags`, `get_trend(stream, months)`. These return structured data so Claude can explain and recommend.

### 4.4 To-dos and Outlook

- Microsoft Graph: read Outlook inbox (summaries), read and create calendar events, and read, create and complete Microsoft To Do tasks.
- Jarvis's to-do list is Microsoft To Do, so tasks stay in sync with Outlook and the phone.
- **Sending rule:** Jarvis may draft emails into Outlook Drafts but must never send. Jasper sends himself.

MCP tools: `list_tasks`, `add_task`, `complete_task`, `get_calendar(range)`, `create_calendar_event` (requires a confirmation flag), `search_email`, `summarise_inbox`, `create_email_draft`

### 4.5 Tax and compliance tracker

Jarvis tracks and prepares. It never submits anything to HMRC or Companies House. VAT returns are submitted through Xero, which is MTD-compatible, and reviewed by Qevero's accountant.

- Deadline calendar with reminders, seeded from the company data:
  - VAT returns and payments (quarter end dates as assigned by HMRC, entered in the Company Vault)
  - Corporation tax payment and CT600 filing
  - Annual accounts to Companies House
  - Confirmation statement
  - PAYE/RTI, if payroll is started
  - Insurance renewals
- Deadline rules live in config and must be confirmed with the accountant before going live. Show "unverified" badges until confirmed.
- VAT readiness checks from Xero data: output VAT on sales, input VAT on bills, an estimated liability for the current quarter, transactions missing VAT codes, bills missing receipts, and unreconciled bank lines.
- Corporation tax estimate: running profit and estimated CT set-aside, clearly labelled as an estimate and not tax advice.
- "Money to set aside" widget: VAT due plus estimated CT.

MCP tools: `get_upcoming_deadlines`, `get_vat_position(quarter)`, `get_vat_issues`, `get_tax_set_aside`, `mark_deadline_done`

## 5. Security and data handling

- Single user (Jasper). Supabase Auth with MFA on the dashboard. RLS on every table.
- The MCP server uses OAuth. Tokens are short-lived. Xero and Microsoft refresh tokens are encrypted at rest.
- Least-privilege scopes on Xero and Graph. Read-only wherever possible.
- No secrets in the repo. Use Netlify environment variables.
- Audit log of every write action Jarvis takes (tasks, drafts, calendar, company data).
- UK GDPR: data is stored in an EU/UK region where the free tier allows it, and there is an export-all-data function.

## 6. Build phases (stop for review after each)

1. **Foundations and voice core.** Repo, PWA shell, Supabase, dashboard login, MCP server with OAuth deployed and added to Claude as a custom connector, Company Vault, Siri Shortcut instructions. *Done when:* Jasper can ask Claude on his iPhone "what's our VAT number?" and get it through the connector.
2. **Thought journal.** *Done when:* a spoken ramble in Claude voice mode is saved as a structured entry and appears on the dashboard.
3. **To-dos and Outlook.** *Done when:* "add a task to chase World of Beds on Friday" appears in Microsoft To Do, and "what's on tomorrow" reads the calendar.
4. **Revenue dashboard.** *Done when:* Xero sync works, revenue shows by stream, attention flags fire, and Claude can answer "which stream needs attention?"
5. **Tax and compliance tracker.** *Done when:* all deadlines show with reminders, and the VAT position and issues for the current quarter match Xero.
6. **Polish.** HUD styling, morning summary view, optional desktop wake word.

## 7. Working rules for Claude Code

- Read this brief fully before starting. Propose a short plan per phase and wait for approval.
- Never add a paid service, API key or subscription without asking.
- Never call an LLM API from the app.
- Ask before choosing between materially different options. Small implementation choices are yours.
- Write tests for analytics calculations and tax deadline logic.
- Keep a `README.md` with setup steps Jasper can follow (Xero app registration, Azure app registration, adding the custom connector, the Siri Shortcut).
- Use UK English, GBP and UK date formats (DD/MM/YYYY) throughout.

## 8. Open questions (for Jasper)

1. Is Outlook a Microsoft 365 Business account on qevero.com, or a personal Outlook.com address? This changes the Graph setup.
2. What VAT quarter end dates has HMRC assigned? And which VAT scheme is Qevero on (standard, flat rate, cash accounting)?
3. What is the accounting year end?
4. Are invoices already tagged by revenue stream in Xero? If not, we set up the tracking category first.
