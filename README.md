# Jarvis — Qevero's business assistant

Jarvis is two things:

1. **A remote MCP server** that you add to Claude as a custom connector. Claude (on your iPhone or desktop, using your existing Pro subscription) calls its tools to read and update Qevero's data. That is how Claude "becomes" Jarvis.
2. **A dashboard** that installs on your iPhone home screen and desktop as an app (PWA) and shows the same data visually.

Jarvis never calls an AI API, and there is no Anthropic API key anywhere. Everything runs on free tiers (see [Running costs](#running-costs-0)).

**Status: Phase 1 (Foundations and voice core).** Covers the Company Vault, secure login with MFA, the Claude connector with OAuth, the audit log and the data export.

---

## Contents

1. [How it fits together](#how-it-fits-together)
2. [One-time setup](#one-time-setup)
   1. [Supabase](#1-supabase-database-login-file-storage)
   2. [Netlify](#2-netlify-hosting)
   3. [First sign-in and MFA](#3-first-sign-in-and-mfa)
   4. [Add the Claude connector](#4-add-jarvis-to-claude-custom-connector)
   5. [iPhone: Siri Shortcut and Action Button](#5-iphone-siri-shortcut-action-button-and-home-screen-app)
3. [Using Jarvis](#using-jarvis)
4. [Security](#security)
5. [Running costs (£0)](#running-costs-0)
6. [Development](#development)
7. [Known limitations](#known-limitations)

---

## How it fits together

```
iPhone / desktop                 Netlify (free)                     Supabase (free, London)
┌──────────────┐  MCP over HTTPS ┌───────────────────────────┐      ┌──────────────────────────┐
│ Claude app   │ ──────────────▶ │ /api/mcp  (Jarvis tools)  │ ───▶ │ Postgres + RLS           │
│ (voice mode) │  Bearer token   │ /oauth/consent            │      │ Storage (vault bucket)   │
└──────────────┘                 │ dashboard pages (PWA)     │      │ Auth: login, MFA,        │
┌──────────────┐                 │ scheduled keep-alive      │      │ OAuth 2.1 server         │
│ Jarvis PWA   │ ──────────────▶ └───────────────────────────┘      └──────────────────────────┘
└──────────────┘
```

When you connect, Claude finds Jarvis's authorisation server (Supabase Auth) through `/.well-known/oauth-protected-resource`, registers itself, and sends you to Jarvis's consent page. You sign in with your password and MFA code and press **Approve**. Claude then receives a short-lived token, and every tool call runs as you, under Row Level Security, and is recorded in the audit log.

---

## One-time setup

You need free accounts with **Supabase**, **Netlify** and **GitHub**, plus your **Claude Pro** account.

### 1. Supabase (database, login, file storage)

1. Go to [supabase.com](https://supabase.com) and create a **new project**:
   - Name: `jarvis`
   - Region: **West EU (London) – eu-west-2**
   - Plan: Free
   - Save the database password in your password manager.
2. **Create the tables.** Open **SQL Editor → New query**, paste the whole of `supabase/migrations/20261101000000_phase1_foundations.sql` and click **Run**. You should see "Success. No rows returned."
3. **Create your login** in **Authentication → Users → Add user → Create new user**:
   - Email: your Jarvis email. This must match `JARVIS_OWNER_EMAIL` below.
   - Password: a strong, unique one.
   - Tick **Auto Confirm User**.
4. **Block anyone else from signing up.** In **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up". Leave the Email provider enabled.
5. **Check MFA is on.** In **Authentication → Multi-Factor**, **TOTP (App Authenticator)** should be enabled. It is by default.
6. **Turn on the OAuth server**, which is what lets Claude connect. In **Authentication → OAuth Server**:
   - Enable the OAuth 2.1 server.
   - Set **Authorization Path** to `/oauth/consent`.
   - Turn on **Allow Dynamic OAuth Apps**. Claude registers itself automatically, and nothing gets access until you approve it on the consent screen.
7. **Switch to asymmetric signing keys** (recommended). In **Project Settings → JWT Keys**, migrate to the new signing keys (ECC P-256 or RSA). Jarvis can then verify Claude's tokens locally against the public key set.
8. **Set the Site URL** after Netlify gives you a URL (step 2). In **Authentication → URL Configuration**, set Site URL to your Netlify URL, e.g. `https://jarvis-qevero.netlify.app`.
9. **Copy your API details** from **Project Settings → API Keys** / **Data API**: the **Project URL** and the **publishable key** (`sb_publishable_…`). Jarvis never needs the secret or `service_role` key; don't put it anywhere.

> The OAuth server is a **beta** Supabase feature. It's available on the free plan at no extra cost.

### 2. Netlify (hosting)

1. Push this repository to GitHub as a private repository.
2. In Netlify: **Add new project → Import an existing project → GitHub →** choose the repo. Netlify detects Next.js automatically; the build settings are in `netlify.toml`.
3. Before deploying, add these in **Site configuration → Environment variables**:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
   | `JARVIS_OWNER_EMAIL` | The email you created in Supabase step 3 |
   | `VAULT_ENCRYPTION_KEY` | Output of `openssl rand -base64 32` (see below) |
   | `JARVIS_SITE_URL` | *(optional)* your final URL, if you add a custom domain |

   To generate the encryption key on a Mac, open Terminal and run:

   ```bash
   openssl rand -base64 32
   ```

   **Save the key in your password manager.** If it is lost, the encrypted fields (UTR and bank details) can't be read and will need to be re-entered.
4. **Deploy.** Then rename the site under **Site configuration → Change site name** (e.g. `jarvis-qevero`) and go back to Supabase step 8 to set the Site URL.
5. The daily `keepalive` scheduled function, which stops the free Supabase project from pausing, appears under **Logs → Functions**.

### 3. First sign-in and MFA

1. On your iPhone, open your Jarvis URL in **Safari** and sign in.
2. You'll be asked to set up an authenticator app: scan the QR code with Microsoft Authenticator, Google Authenticator or 1Password, then enter the 6-digit code.
3. Every future sign-in needs the password and a code.
4. Open **Vault**. Some details are already filled in: Qevero Ltd, incorporated 03/10/2026, VAT registered 03/10/2026, quarterly VAT returns, year end 31/10. Add the rest: company number, registered office, VAT number, VAT scheme, VAT quarter end months (from your VAT certificate), UTR and so on.

### 4. Add Jarvis to Claude (custom connector)

Custom connectors are available on Claude Pro. You add the connector once on the web or desktop app, and it's then available in the iPhone app too.

1. Go to **claude.ai → Settings → Connectors → Add custom connector**. The Jarvis dashboard also shows this URL, with a copy button, under **Settings → Claude connector**.
   - Name: `Jarvis`
   - URL: `https://<your-site>.netlify.app/api/mcp`
2. Click **Connect**. You'll be sent to the Jarvis sign-in page (password + MFA), then the **Connect Claude to Jarvis?** screen. Check the return address is `https://claude.ai/…` or `https://claude.com/…` and press **Approve**.
3. In a Claude chat, open the tools menu and make sure **Jarvis** is switched on.
4. **Test it (this is Phase 1's acceptance check).** On your iPhone, open Claude, start voice mode and ask *"What's our VAT number?"*. Claude should call `get_company_profile` and read it back.

The approval appears in the dashboard's **Settings → Audit log**. To revoke access, disconnect the connector in Claude and, if you like, delete the client under Supabase **Authentication → OAuth Apps**.

### 5. iPhone: Siri Shortcut, Action Button and home-screen app

iOS doesn't allow apps to listen for "Hey Jarvis" in the background, so Jarvis uses a Shortcut instead.

**Shortcut 1 — "Jarvis" (opens Claude)**

1. Open the **Shortcuts** app → **+**.
2. Tap **Add Action**, search **Claude**, and choose one of:
   - **Ask Claude** (iOS 18 and later). Its microphone option opens Claude ready for dictation.
   - **Open App → Claude**, which simply opens the app.
3. Rename the shortcut **Jarvis** (tap the name at the top).
4. You can now say **"Hey Siri, Jarvis"**.

> **Voice mode check:** I checked Anthropic's iOS help for a Shortcuts action that starts **voice mode** directly and didn't find one. The "Ask Claude" microphone option starts dictation, which is speech-to-text into the message box; that isn't the two-way voice conversation. Until a voice-mode action exists, tap the voice-mode button once Claude opens. It's worth checking the Claude actions in the Shortcuts app now and then; if a voice-mode action appears, swap it into this shortcut.

**Map it to the Action Button** (iPhone 15 Pro and later)

1. **Settings → Action Button**.
2. Swipe to **Shortcut**, tap **Choose a Shortcut**, pick **Jarvis**.
3. A long press of the Action Button now opens Claude.

**Install the dashboard app**

1. Open your Jarvis URL in **Safari** and sign in.
2. Tap **Share → Add to Home Screen → Add**. Jarvis then opens full-screen like an app.

**Shortcut 2 — "Jarvis Dashboard"** (optional)

1. Shortcuts → **+** → **Add Action** → **Open URLs**, then enter your Jarvis URL.
2. Rename it **Jarvis Dashboard**, so you can say "Hey Siri, Jarvis Dashboard".
3. iOS opens URLs from Shortcuts in Safari rather than in the home-screen app, so the home-screen icon is the better way in day to day.

---

## Using Jarvis

Things to say or type in Claude with the Jarvis connector on:

- "What's our VAT number?" / "What's our company number?"
- "When is our year end?" / "When does the professional indemnity insurance renew?"
- "What's our UTR?" (Claude gives the masked value. Say "give me the full UTR" to have it passed `reveal: true`, which is logged.)
- "Update our registered office to …" (Claude reads the change back and asks you to confirm before saving.)
- "Send me the link to the VAT certificate."

**Phase 1 MCP tools**

| Tool | What it does |
|---|---|
| `get_company_profile` | Company, VAT, tax, banking and adviser fields, plus directors, insurance, suppliers and subscriptions. Sensitive fields are masked unless `reveal: true`. |
| `update_company_field` | Sets or clears one field, with validation (VAT number, company number, UTR, DD/MM/YYYY dates). |
| `list_documents` | Lists files in the vault, optionally filtered by category. |
| `get_document` | Document details plus a private download link that expires after 10 minutes. |

---

## Security

- **Single user.** Only `JARVIS_OWNER_EMAIL` can get in, public sign-ups are disabled, and every page and action requires MFA (Supabase `aal2`).
- **Row Level Security on every table and the storage bucket.** The app uses only the publishable key, and data is read with your own session or Claude's OAuth token. There is no service-role key in the app.
- **The MCP endpoint never accepts anonymous calls.** Each request needs a valid, unexpired token from this project's Auth server that has an OAuth `client_id` and belongs to your email. Otherwise it gets `401` and an OAuth challenge.
- **The consent screen only approves Claude's exact callback URLs** (`OAUTH_ALLOWED_REDIRECT_URIS`), only after an MFA sign-in, and only from a same-origin form post.
- **Sensitive fields** (UTR, sort code, account number) are encrypted with AES-256-GCM in the app before they reach the database. They are masked by default and never written to logs or the audit trail. Revealing them is itself logged.
- **Append-only audit log** of every write and every reveal, whether from the dashboard or from Claude. It's visible in Settings.
- **Nothing private is cached.** The service worker caches only static build files and icons, and pages are sent `no-store`.
- **No secrets in the repo.** `.env*` files are git-ignored, and everything sensitive lives in Netlify environment variables.
- **UK GDPR.** Data is stored in Supabase's London region, and **Settings → Export all data** downloads everything as JSON.

---

## Running costs (£0)

| Service | Plan | Notes |
|---|---|---|
| Claude | Your existing Pro subscription | Jarvis adds no AI cost. |
| Netlify | Free | Hosting, functions, the daily scheduled function. A single user is far below the limits. |
| Supabase | Free | Database, Auth (MFA + OAuth server), 1 GB storage. Free projects pause after 7 days of inactivity, which the daily keep-alive prevents. |
| Xero, Microsoft Graph | Free developer tiers | From Phases 3 and 4. |

If any feature ever needs a paid service, it will be raised with you before it's added.

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

- `app/` holds the dashboard pages, the MCP endpoint (`app/api/mcp`), the consent page (`app/oauth/consent`) and the data export.
- `lib/vault/` holds the Company Vault field registry, the service shared by the dashboard and MCP, and the Supabase store.
- `lib/mcp/` holds MCP tool definitions and token verification.
- `supabase/migrations/` holds the database schema and RLS.
- `netlify/functions/` holds scheduled functions.
- `tests/` holds Vitest tests, including an end-to-end test of `/api/mcp` with a fake token verifier.

Conventions: UK English, GBP, DD/MM/YYYY on screen (ISO in the database), and Europe/London time.

---

## Known limitations

- **Supabase OAuth server is in beta**, so it could change. If connecting starts failing, check Supabase's changelog first.
- **Token audience.** Supabase tokens use the audience `authenticated`, not the Jarvis URL. Jarvis compensates by requiring a project-issued token that carries an OAuth `client_id` and belongs to your email.
- **Function region.** Data is stored in London, but Netlify's free plan runs functions in its default region, so requests are processed there in transit. Nothing is stored outside Supabase.
- **Voice mode from a Shortcut** isn't currently possible (see above). You tap voice mode once Claude opens.
