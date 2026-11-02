# Jarvis: Qevero's business assistant

Jarvis is two things:

1. **A remote MCP server** that you add to Claude as a custom connector. Claude (iPhone and desktop, on your existing Pro plan) calls its ~65 tools to read and act on Qevero's data. That's how Claude becomes Jarvis.
2. **A dashboard** that installs on your iPhone home screen and desktop (a PWA) and shows the same data visually.

**Zero AI API cost.** Jarvis never calls an LLM API and there is no Anthropic API key anywhere. All analytics are deterministic code. The thinking happens in the Claude app you already pay for. Every other service runs on a free tier (see [Running costs](#running-costs-0)).

---

## What Jarvis does

| Module | On the dashboard | Ask Claude… |
|---|---|---|
| **Morning briefing** | Home: calendar, tasks, flags, money, deadlines, CRM, a journal prompt; "Read briefing" speaks it | "Give me my morning briefing" |
| **Company Vault** | Company, VAT, tax, banking and adviser details, insurance, suppliers, documents | "What's our VAT number?" |
| **Thought journal** | Searchable timeline, filter by theme or client, blog draft export, dictation | "Save this to my journal…" / "What have I been thinking about pricing?" |
| **Memory** | What Jarvis knows; import your Claude chat history | "Remember that…" / "Go through my past chats and remember what matters" |
| **Revenue** | Revenue by stream, recurring vs one-off, growth, top clients, concentration, aged debtors, attention flags, stream mapping | "Which stream needs attention?" / "How do I grow revenue?" |
| **Invoicing** | Draft sales invoices, quotes and purchase orders in Xero; unpaid, drafts and bills | "Invoice World of Beds £4,500 for the website build" |
| **Proposals** | Templates per stream, editor, A4 print/PDF, → Xero quote, → deposit invoice | "Draft an SEO retainer proposal for…" |
| **Work** | Microsoft To Do, 7-day calendar, inbox | "Add a task to chase World of Beds on Friday" / "What's on tomorrow?" |
| **CRM** | Qevero CRM pipeline, CRM tasks, tenders, recent activity (read-only) | "What's in the pipeline?" / "Any tenders closing this week?" |
| **Tax & compliance** | Deadlines with reminders and "unverified" badges, VAT position and readiness issues, CT estimate, money to set aside, Companies House cross-check | "What do I need to set aside for tax?" / "Is the VAT return ready?" |
| **Clients** | Clients, Xero links, monthly retainers (feeds the "retainer not invoiced" flag) | "Set World of Beds' retainer to £750 a month" |

**What Jarvis never does:** send an email, send a calendar invitation, approve or send an invoice, or file anything with HMRC or Companies House. Emails go to **Outlook Drafts**, and the Microsoft permission doesn't even include sending. Invoices, quotes and POs are **Xero drafts**. Calendar events have **no attendees**. Every write is in the **audit log**.

---

## Contents

1. [Architecture](#architecture)
2. [Setup](#setup) (about 60–90 minutes in total)
   1. [Supabase](#1-supabase)
   2. [Netlify](#2-netlify)
   3. [First sign-in and MFA](#3-first-sign-in-and-mfa)
   4. [Claude connector](#4-claude-connector)
   5. [Xero](#5-xero)
   6. [Microsoft (Outlook, Calendar, To Do)](#6-microsoft-outlook-calendar-to-do)
   7. [Qevero CRM connector](#7-qevero-crm-connector)
   8. [Notifications](#8-notifications)
   9. [Companies House (optional)](#9-companies-house-optional)
   10. [Import your Claude chat history](#10-import-your-claude-chat-history)
   11. [iPhone: Siri, Action Button, home screen](#11-iphone-siri-action-button-home-screen)
   12. [Desktop wake word (optional)](#12-desktop-wake-word-optional)
3. [Environment variables](#environment-variables)
4. [Security](#security)
5. [Running costs (£0)](#running-costs-0)
6. [Development](#development)
7. [Known limitations and things to confirm](#known-limitations-and-things-to-confirm)

---

## Architecture

```
iPhone / desktop                  Netlify (free)                          Supabase (free, London)
┌──────────────┐  MCP + OAuth     ┌──────────────────────────────────┐   ┌─────────────────────────┐
│ Claude app   │ ───────────────▶ │ /api/mcp  (~65 Jarvis tools)     │──▶│ Postgres + RLS          │
│ voice mode   │                  │ /oauth/consent                   │   │ Auth: login, MFA,       │
└──────────────┘                  │ dashboard pages (PWA)            │   │ OAuth 2.1 server        │
┌──────────────┐                  │ /api/cron/tick ◀─ hourly fn       │   │ Storage (vault files)   │
│ Jarvis PWA   │ ───────────────▶ └───────┬───────────┬──────────┬───┘   └─────────────────────────┘
└──────────────┘                          │           │          │
                                   Xero API    Microsoft Graph   Qevero CRM (read-only RPC)
```

- **Claude ↔ Jarvis:** Claude discovers Supabase Auth via `/.well-known/oauth-protected-resource`, registers itself, sends you to Jarvis's consent page (password + MFA), and gets a short-lived token. Every tool call runs as you under Row Level Security.
- **Xero:** OAuth 2.0 with PKCE. An incremental mirror (invoices, bills, credit notes, contacts, bank transactions, accounts) syncs into Supabase every 6 hours, within a daily call budget for the Starter tier. Reports (P&L, bank summary) are cached.
- **Microsoft:** delegated Graph access to your personal Outlook.com account (To Do, Calendar, Mail read + drafts).
- **CRM:** a token-gated, read-only SQL function in the CRM's Supabase (see `integrations/qevero-crm/`).
- **Hourly tick:** Xero sync, morning briefing push, deadline reminders (push + To Do task), and Supabase keep-alive.

---

## Setup

You'll need free accounts for **Supabase**, **Netlify**, the **Xero Developer portal**, and an **Azure/Entra app registration**, plus your Claude Pro account.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com):
   - Name: `jarvis`
   - Region: **West EU (London) – eu-west-2**
   - Plan: Free
   - Save the database password in your password manager.
2. **SQL Editor → New query.** Paste and **Run** each migration in `supabase/migrations/`, in order:
   1. `20261101000000_phase1_foundations.sql`
   2. `20261102000000_jarvis_modules.sql`
3. **Create your login** in **Authentication → Users → Add user → Create new user**:
   - Use your email; it must match `JARVIS_OWNER_EMAIL`.
   - Choose a strong password.
   - Tick **Auto Confirm User**.
4. **Turn off sign-ups** in **Authentication → Sign In / Providers**: switch off "Allow new users to sign up". Keep Email enabled.
5. **Check MFA** in **Authentication → Multi-Factor**: TOTP should be enabled (it is by default).
6. **Turn on the OAuth server** in **Authentication → OAuth Server**:
   - Enable it.
   - Set **Authorization Path** to `/oauth/consent`.
   - Turn on **Allow Dynamic OAuth Apps**.
7. **Switch to asymmetric signing keys** (recommended) in **Project Settings → JWT Keys**.
8. **API keys** (Project Settings → API Keys): copy the **Project URL**, the **publishable key** (`sb_publishable_…`) and the **secret key** (`sb_secret_…`). The secret key is used **only** by the hourly scheduled job and never reaches a browser.
9. After step 2.4, come back and set **Authentication → URL Configuration → Site URL** to your Netlify URL.

### 2. Netlify

Your code is on GitHub at `Qevero/Jarvis`.

1. An empty Netlify project, **`jarvis-qevero`**, has already been created (https://jarvis-qevero.netlify.app). Open it in Netlify → **Project configuration → Build & deploy → Link repository → GitHub → Qevero/Jarvis**, branch `main`. The build settings come from `netlify.toml`.
2. Before the first deploy, add the [environment variables](#environment-variables) under **Site configuration → Environment variables** (scope: Builds + Functions). At minimum you need:
   - the Supabase variables
   - `JARVIS_OWNER_EMAIL`
   - `VAULT_ENCRYPTION_KEY`
   - `CRON_SECRET`
3. Trigger a deploy. Return to Supabase step 1.9 and set the Site URL to `https://jarvis-qevero.netlify.app`.
4. The hourly `cron-tick` function appears under **Logs → Functions**.

### 3. First sign-in and MFA

1. Open the site in Safari on your iPhone and sign in.
2. Scan the QR code with an authenticator app (Microsoft Authenticator, Google Authenticator or 1Password) and enter the code.
3. Open **Vault**. These are pre-filled:
   - Qevero Ltd, company number **17497612**
   - incorporated 03/10/2026
   - VAT **GB531607691**, registered 03/10/2026
   - **Standard** scheme, quarters **Mar/Jun/Sep/Dec**, first VAT period ending 31/12/2026
   - year end **31/10**

   Add the rest: registered office, UTR, bank details, accountant. **Check the first VAT period end against your VAT certificate**, because HMRC sometimes sets a longer first period.

### 4. Claude connector

1. Go to claude.ai → **Settings → Connectors → Add custom connector**:
   - Name: `Jarvis`
   - URL: `https://<your-site>.netlify.app/api/mcp` (also shown in Jarvis → Settings with a copy button)
2. Click **Connect**. Sign in to Jarvis (password + MFA), check the return address is `claude.ai`/`claude.com`, and press **Approve**.
3. In a chat, make sure Jarvis is switched on in the tools menu. It's then available in the Claude iPhone app too.
4. **Recommended:** in Claude → Settings, turn on **memory** and **search and reference chats**. Claude can then pull context from your other chats and save it into Jarvis with `remember`.
5. Test it: "What's our VAT number?"

### 5. Xero

Jarvis needs its own Xero app (the Xero connector inside Claude is separate and doesn't give the dashboard access).

1. Go to [developer.xero.com](https://developer.xero.com) → **My Apps → New app**:
   - App name: `Jarvis (Qevero)`
   - Integration type: **Web app**
   - Company URL: `https://qevero.com`
   - Redirect URI: `https://<your-site>.netlify.app/api/integrations/xero/callback`
2. Open the app → **Configuration**. Copy the **Client ID** and **generate a client secret**.
3. Add both to Netlify as `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`, then redeploy.
4. Jarvis → **Settings → Connect Xero**. Choose **Qevero Ltd** and allow access. The first sync runs straight away.
5. **Revenue streams:** your Xero has no tracking categories yet. In **Settings** (or Revenue → Stream mapping), press **Create "Revenue Stream" tracking category**. This adds Website Builds, SEO/GEO Retainers, Paid Media, Software & Hosting and Creative/Content. Invoices Jarvis drafts are tagged automatically. For anything else, tag the lines in Xero or map them on **Revenue → Stream mapping**.

**Scopes:** `accounting.transactions` (to create drafts), `accounting.contacts`, `accounting.settings` (only for the one-off tracking category set-up), `accounting.reports.read` and `accounting.attachments.read`. If Xero rejects these because your app requires its newer granular scopes, set `XERO_SCOPES` in Netlify to the equivalents listed on your app's Configuration page.

**Starter tier limits:** Jarvis counts its own calls and stops at `xeroDailyCallBudget` (default **900/day**, adjustable in Settings), syncs every 6 hours, and caches reports. Set the budget to whatever your Xero plan allows.

### 6. Microsoft (Outlook, Calendar, To Do)

qevero@outlook.com is a **personal Microsoft account**, so the app registration lives in a (free) Microsoft Entra tenant. If you don't have one, sign up for a free Azure account with the same Microsoft account. It may ask for a card to verify identity, but there's no charge.

1. Go to [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**:
   - Name: `Jarvis`
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: **Web**, `https://<your-site>.netlify.app/api/integrations/microsoft/callback`
2. **Certificates & secrets → New client secret**. Choose 24 months and **put a reminder in your calendar to renew it**.
3. **API permissions → Add → Microsoft Graph → Delegated**: `offline_access`, `openid`, `email`, `User.Read`, `Tasks.ReadWrite`, `Calendars.ReadWrite`, `Mail.ReadWrite`.
   - Don't add `Mail.Send`. Jarvis drafts but never sends.
4. Add `MICROSOFT_CLIENT_ID` (Application ID) and `MICROSOFT_CLIENT_SECRET` (the secret **value**) to Netlify, then redeploy.
5. Jarvis → **Settings → Connect Microsoft** and sign in as qevero@outlook.com.

> Your CRM already has a Microsoft app for Outlook sync. You *can* add Jarvis's redirect URI to that same registration and reuse its ID and secret, but a separate app keeps permissions clearly scoped.

### 7. Qevero CRM connector

Jarvis reads the CRM (`Qevero/qevero-crm`) through one read-only function. It never writes to the CRM.

1. Generate a token:

   ```bash
   openssl rand -hex 32
   ```

2. In the **CRM's** Supabase project → SQL Editor, run `integrations/qevero-crm/jarvis_connector.sql`. Or add it to the CRM repo as a new migration (the CRM's rules say schema changes go in `supabase/migrations/`).
3. In the same SQL editor, register the token (replace the placeholder):

   ```sql
   insert into jarvis.connector (org_id, token_hash)
   values ((select id from public.organisations where name ilike 'Qevero%' limit 1),
           encode(sha256(convert_to('PASTE-TOKEN-HERE', 'UTF8')), 'hex'));
   ```

4. Add these to Jarvis's Netlify environment variables, then redeploy:
   - `CRM_SUPABASE_URL`
   - `CRM_SUPABASE_PUBLISHABLE_KEY` (the CRM's publishable/anon key)
   - `CRM_CONNECTOR_TOKEN`
   - optionally `CRM_APP_URL`
5. To revoke access at any time, run `delete from jarvis.connector;` in the CRM's database.

The connector returns pipeline and quoted value, leads, lead detail with timeline, CRM tasks (with Hen/Jas assignees), open tender matches, company detail and recent activity. It's tested against the CRM's real migrations in `tests/sql/crm-connector.test.ts`.

### 8. Notifications

Notifications are free Web Push. On iPhone they need iOS 16.4+ and Jarvis installed to the Home Screen.

1. Generate VAPID keys:

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to Netlify, then redeploy.
3. Open Jarvis **from the Home Screen icon** → Settings → **Enable notifications** → **Send a test notification**.

You'll get the morning briefing at 07:00 UK time, and deadline reminders 30, 7 and 1 days before each deadline (all adjustable). With Microsoft connected, each deadline is also added to Microsoft To Do 30 days ahead, so it reminds you on every device.

### 9. Companies House (optional)

Get a free key at [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk) (a "REST" application) and add it as `COMPANIES_HOUSE_API_KEY`. The Tax page will then cross-check Jarvis's accounts and confirmation-statement dates against the official record, and Claude gets `check_companies_house`.

### 10. Import your Claude chat history

Jarvis can't read claude.ai directly; there's no API for it, and it never uses your Claude login. Instead:

1. claude.ai → **Settings → Privacy → Export data**. Download the zip from Anthropic's email.
2. Jarvis → **Memory → Import Claude chat history** → choose the zip. It's read on your device; only message text is uploaded.
3. In Claude with Jarvis on, say: *"Go through my undigested past chats and remember anything important about Qevero, clients, pricing and how I like to work."* Claude reads each chat (`list_past_chats`, `get_past_chat`), saves knowledge (`remember`), and marks it done (`save_chat_digest`).
4. Re-import whenever you like. Only new chats and messages are added.

Day to day, Jarvis's instructions tell Claude to call `get_core_memories` at the start of substantial chats and `remember` whenever you share something worth keeping. Claude's own memory and chat search complement this.

### 11. iPhone: Siri, Action Button, home screen

iOS doesn't allow background "Hey Jarvis" listening, so you use a Shortcut.

**Shortcut 1: "Jarvis" (opens Claude)**

1. Open Shortcuts → **+** → **Add Action**, search **Claude** and choose either:
   - **Ask Claude** (iOS 18+; its microphone option opens dictation), or
   - **Open App → Claude**.
2. Rename the shortcut **Jarvis**. You can now say "Hey Siri, Jarvis".

> **Voice mode check:** Anthropic's iOS help doesn't list a Shortcuts action that starts **voice mode** directly. "Ask Claude" with the microphone opens *dictation*, not two-way voice. After Claude opens, tap the voice-mode button. If a voice-mode action appears in a future Claude update, swap it in.

**Action Button** (iPhone 15 Pro and later): Settings → Action Button → **Shortcut** → **Jarvis**.

**Dashboard app:** open Jarvis in Safari → Share → **Add to Home Screen**. Optionally add **Shortcut 2, "Jarvis Dashboard"**: an Open URLs action with your Jarvis URL. Shortcuts open URLs in Safari rather than the home-screen app, so the icon is the better way in.

### 12. Desktop wake word (optional)

See `desktop/wake-word/README.md`: say "Hey Jarvis" and the Claude desktop app comes to the front. It runs locally with openWakeWord. **Read the model licence note first.** The pre-trained "hey jarvis" model is non-commercial, so the README explains how to train your own for free.

---

## Environment variables

Set these in Netlify → Site configuration → Environment variables (scopes: Builds and Functions). Use Supabase's new short key formats to stay well inside Netlify's ~4 KB function environment limit.

| Variable | Required | What it is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✓ | Supabase publishable key |
| `SUPABASE_SECRET_KEY` | ✓ for scheduled jobs | Supabase secret key. Used **only** by `/api/cron/tick` (Xero sync, reminders). Never `NEXT_PUBLIC_`. |
| `JARVIS_OWNER_EMAIL` | ✓ | Your login email; the only account allowed in |
| `VAULT_ENCRYPTION_KEY` | ✓ | `openssl rand -base64 32`. Encrypts sensitive vault fields and Xero/Microsoft tokens. **Back it up.** |
| `CRON_SECRET` | ✓ | `openssl rand -hex 32`. Authenticates the hourly job. |
| `JARVIS_SITE_URL` | | Your URL if you add a custom domain (defaults to Netlify's `URL`) |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | for Xero | From developer.xero.com |
| `XERO_SCOPES` | | Override the default Xero scopes |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | for Outlook | From the Entra app registration |
| `MICROSOFT_TENANT` | | Defaults to `consumers` (personal accounts) |
| `CRM_SUPABASE_URL`, `CRM_SUPABASE_PUBLISHABLE_KEY`, `CRM_CONNECTOR_TOKEN` | for CRM | See [CRM connector](#7-qevero-crm-connector) |
| `CRM_APP_URL` | | Link to the CRM app |
| `COMPANIES_HOUSE_API_KEY` | | Companies House cross-checks |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | for push | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | | Defaults to `mailto:qevero@outlook.com` |
| `OAUTH_ALLOWED_REDIRECT_URIS` | | Claude callbacks the consent page may approve |

---

## Security

- **Single user.** Only `JARVIS_OWNER_EMAIL` can sign in. Sign-ups are off, and every page, action and route requires MFA (`aal2`).
- **Row Level Security on every table** (25 tables) and on the storage bucket, all owner-only. This is tested in `tests/sql/migrations.test.ts` against real Postgres.
- **MCP endpoint:** no anonymous access. Tokens must be unexpired, issued by this project, carry an OAuth `client_id` (so a stolen dashboard session can't be used), and belong to the owner. The consent page approves only Claude's exact callback URLs, after an MFA sign-in, from a same-origin POST.
- **Encryption:** UTR, sort code, account number, and Xero/Microsoft access and refresh tokens are encrypted (AES-256-GCM) before they reach the database. Sensitive fields are masked unless you explicitly ask for them, and they're never logged.
- **Least privilege:**
  - Microsoft has no `Mail.Send`.
  - Calendar events have no attendees.
  - Xero documents are created as drafts only.
  - The CRM connector is read-only, behind a revocable token.
  - The Supabase secret key is used only by the scheduled job, which filters every query by owner.
- **Audit log:** every write (from the dashboard, from Claude, or from the scheduled job) plus every reveal of a sensitive field. It can only be appended to.
- **Caching:** the service worker caches only static assets. Pages are `no-store`, so no financial data stays on the device.
- **UK GDPR:** data is stored in London. **Settings → Export all data** downloads everything as JSON, excluding OAuth tokens.
- **Public repository warning:** `Qevero/Jarvis` is currently **public**. It contains no secrets, but it does contain your business logic, so consider making it private (GitHub → Settings → General → Danger zone → Change visibility).

---

## Running costs (£0)

| Service | Plan | Notes |
|---|---|---|
| Claude | Your existing Pro | No API usage at all |
| Netlify | Free | Next.js hosting, functions, one hourly scheduled function |
| Supabase | Free | ~500 MB database (plenty, unless you import a very large chat history), MFA, OAuth server (beta, free) |
| Xero Developer | Starter (free) | Daily call budget enforced by Jarvis |
| Microsoft Entra / Graph | Free | App registration plus delegated Graph |
| Web Push, Web Speech | Free | Browser built-ins plus VAPID |
| Companies House API | Free | Optional |

---

## Development

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run typecheck && npm run lint && npm run build
```

- `lib/revenue/`, `lib/tax/`, `lib/invoicing/`, `lib/journal/`, `lib/knowledge/`, `lib/briefing/`: pure, tested domain logic (analytics, attention flags, deadline rules, VAT, CT, invoice maths, chat import, briefing).
- `lib/xero/`, `lib/ms/`, `lib/crm/`, `lib/companies-house.ts`, `lib/push.ts`: integrations.
- `lib/services/`: data access shared by the dashboard and the MCP tools.
- `lib/mcp/tools/`: MCP tool definitions, grouped by module.
- `app/(app)/`: dashboard pages and server actions. `app/api/`: MCP, OAuth, cron, imports, exports.
- `supabase/migrations/`: schema and RLS. `integrations/qevero-crm/`: the CRM connector SQL.
- `tests/`: Vitest unit tests plus SQL tests in PGlite (Jarvis's migrations, and the CRM connector against the CRM's migrations when `./qevero-crm` is cloned).

UK English, GBP, DD/MM/YYYY and Europe/London throughout.

---

## Known limitations and things to confirm

- **Confirm tax rules with your accountant.** Every rule shows "unverified" until you record the confirmation on the Tax page. Specific points to check:
  - The first VAT period end (assumed 31/12/2026).
  - The CT start date: assumed to be incorporation. Set "Corporation tax start date" if trading started later.
  - That the 13-month first period of account (03/10/2026–31/10/2027) splits into CT periods 03/10/2026–02/10/2027 and 03/10/2027–31/10/2027.
  - That first accounts are due 03/07/2028.
- **VAT figures are estimates** from Jarvis's copy of Xero on the standard accrual basis. Xero's MTD return is authoritative.
- **Supabase's OAuth server is beta.** If connecting Claude fails after a Supabase change, check their changelog.
- **Xero scopes:** see the note in [Xero](#5-xero) if your app requires granular scopes.
- **Function region:** data is stored in London. Netlify's free plan runs functions in its default (US) region, so data passes through there in transit but is never stored there.
- **Voice mode** can't currently be started from a Shortcut, so tap it once Claude opens.
- **Chat history** isn't synced live. Re-import the Claude export periodically, and rely on Claude's own memory and chat search between imports.
