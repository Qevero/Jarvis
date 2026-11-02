# Setting up Jarvis: the easy guide

This guide assumes no technical knowledge. Follow it from top to bottom, and **do one part at a time**. You can stop after any part and come back later.

Everything here is **free**. If any website asks for payment, stop and check, because you've probably clicked the wrong plan.

---

## Before you start

**You'll need:**

- **Your HP laptop.** Most of the setup is easier on a big screen.
- **Your iPhone.**
- **A password manager** (1Password, Bitwarden, or the iPhone Passwords app). You'll be saving a few passwords and keys.
- **An authenticator app on your iPhone**, such as **Microsoft Authenticator** (free on the App Store). It gives you 6-digit codes for logging in safely.
- **About 2 hours in total.** Parts 1–5 (about 1 hour) get Jarvis working. The rest adds features.

**A few words you'll see:**

| Word | What it means |
|---|---|
| **Supabase** | Where Jarvis stores its data (a database). Think of it as Jarvis's filing cabinet. |
| **Netlify** | Where Jarvis's website lives on the internet. |
| **GitHub** | Where Jarvis's code is kept. You don't need to touch the code. |
| **Environment variable** | A setting you type into Netlify, made of a **name** (e.g. `CRON_SECRET`) and a **value** (e.g. a long random password). It's how Jarvis gets its passwords without them being in the code. |
| **Migration** | A file of instructions that sets up the database. You copy it, paste it into Supabase and press Run. |
| **Connector** | How the Claude app plugs into Jarvis. |
| **Deploy** | Netlify building and publishing the latest version of Jarvis. |

**Golden rule:** keys and secrets go **only** into Netlify, Supabase and your password manager. Never paste them into an email, a chat, or a Claude conversation.

---

## Part 1: Create the database (Supabase), about 15 minutes

### 1a. Make the project

1. On your laptop, go to **https://supabase.com** and click **Start your project**. Sign up; using **Continue with GitHub** is easiest.
2. If it asks you to create an **organisation**, call it `Qevero` and choose the **Free** plan.
3. Click **New project** and fill in:
   - **Name:** `jarvis`
   - **Database password:** click **Generate a password**, then **save it in your password manager** as "Supabase Jarvis database".
   - **Region:** **West EU (London)**
4. Click **Create new project** and wait about 2 minutes while it sets up.

### 1b. Set up the database (the 4 migration files)

You'll do this four times, once per file, **in this order**:

| Order | File |
|---|---|
| 1 | [`20261101000000_phase1_foundations.sql`](https://github.com/Qevero/Jarvis/blob/main/supabase/migrations/20261101000000_phase1_foundations.sql) |
| 2 | [`20261102000000_jarvis_modules.sql`](https://github.com/Qevero/Jarvis/blob/main/supabase/migrations/20261102000000_jarvis_modules.sql) |
| 3 | [`20261103000000_personal.sql`](https://github.com/Qevero/Jarvis/blob/main/supabase/migrations/20261103000000_personal.sql) |
| 4 | [`20261104000000_labs.sql`](https://github.com/Qevero/Jarvis/blob/main/supabase/migrations/20261104000000_labs.sql) |

For each file:

1. Click the file name in the table above. It opens on GitHub.
2. Click the **Copy raw file** button (two overlapping squares, top right of the code).
3. In Supabase, click **SQL Editor** in the left-hand menu (the icon looks like `>_`), then **+ New query** (or "New SQL snippet").
4. Click in the big empty box, press **Ctrl+V** to paste, then click **Run** (bottom right).
5. You should see **"Success. No rows returned"**. If Supabase shows a warning about "destructive operations", click **Run this query** anyway. That's expected.

✅ **Check:** click **Table Editor** in the left menu. You should see lots of tables (`audit_log`, `company_fields`, `journal_entries` and more).

> If you get a red error, check you ran the files in order and didn't run one twice. Note the error message and ask Claude Code for help.

### 1c. Create your login

1. Left menu → **Authentication** → **Users** → **Add user** → **Create new user**.
2. **Email:** `qevero@outlook.com` (or whichever email you want to log in with; remember which one, because you'll need it in Part 2).
3. **Password:** make a strong one and **save it in your password manager** as "Jarvis login".
4. Tick **Auto Confirm User**, then click **Create user**.

### 1d. Lock the door so nobody else can sign up

1. **Authentication** → **Sign In / Providers** (sometimes just called "Providers").
2. Switch **off** "Allow new users to sign up". Leave **Email** switched on. Click **Save**.
3. **Authentication** → **Multi-Factor** (or "MFA"): make sure **TOTP** (authenticator app) is **enabled**. It usually is already.

### 1e. Turn on "log in with Jarvis" for Claude

This is what lets the Claude app connect to Jarvis securely.

1. **Authentication** → **OAuth Server**.
2. Turn it **on**.
3. **Authorization path:** type `/oauth/consent`
4. Turn on **Allow Dynamic OAuth Apps** (sometimes worded "dynamic client registration").
5. Click **Save**.

(Optional, recommended: **Project Settings** (cog icon, bottom left) → **JWT Keys** → if there's a button to switch to new **asymmetric** keys, click it.)

### 1f. Copy three things for later

Open a note on your laptop (Notepad is fine; delete it when you're done) and copy these in:

1. **Project URL:** **Project Settings** → **Data API** (or the **Connect** button at the top of the project). It looks like `https://abcdefgh.supabase.co`.
2. **Publishable key:** **Project Settings** → **API Keys**. It starts `sb_publishable_…`
3. **Secret key:** same page, under **Secret keys**. Click to reveal; it starts `sb_secret_…`. Treat it like a bank password.

✅ **Part 1 done.** Leave the Supabase tab open; you'll come back once.

---

## Part 2: Put Jarvis on the internet (Netlify), about 15 minutes

I've already created an empty Netlify site for you called **jarvis-qevero**.

### 2a. Connect it to the code

1. Go to **https://app.netlify.com** and log in (the same account that's connected to Claude).
2. Click the project **jarvis-qevero**.
3. Go to **Project configuration** → **Build & deploy** → **Link repository** (or "Link to Git"). Choose **GitHub**, then **Qevero/Jarvis**.
   - If GitHub asks you to give Netlify access, allow it for the **Jarvis** repository.
4. **Branch:** `main`. Leave every other box as it is (the settings come from the code) and click **Deploy**.
5. Wait 3–5 minutes for the deploy to show **Published**.

Don't worry if https://jarvis-qevero.netlify.app shows an error at this point. It doesn't have its passwords yet.

### 2b. Make your secret keys

1. On your laptop, open **https://jarvis-qevero.netlify.app/setup-keys.html**.
2. This page makes 4 random keys **inside your browser**; nothing is sent anywhere.
3. **Keep this tab open** until you've finished 2c.
4. Save `VAULT_ENCRYPTION_KEY` in your password manager as "Jarvis vault key". If you ever lose it, Jarvis can't unlock your saved bank details and logins.

### 2c. Add the settings (environment variables)

In Netlify: **Project configuration** → **Environment variables** → **Add a variable** → **Add a single variable**.

For each row below:
1. Type the **Key** exactly as shown (capitals and underscores matter).
2. Paste the **Value**.
3. Leave "Same value for all deploy contexts" selected and click **Create variable**.

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the Supabase **Project URL** from 1f |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the **publishable key** from 1f (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | the **secret key** from 1f (`sb_secret_…`) |
| `JARVIS_OWNER_EMAIL` | the email you used in 1c, e.g. `qevero@outlook.com` |
| `JARVIS_SITE_URL` | `https://jarvis-qevero.netlify.app` |
| `VAULT_ENCRYPTION_KEY` | from the keys page |
| `CRON_SECRET` | from the keys page |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | from the keys page |
| `VAPID_PRIVATE_KEY` | from the keys page |

You'll add a few more later (Xero, Microsoft, CRM). The page also shows a CRM token; you can ignore that until Part 9.

### 2d. Publish again with the new settings

1. Netlify → **Deploys** → **Trigger deploy** → **Deploy project** (or "Clear cache and deploy").
2. Wait for **Published**.

> **Remember this step.** Every time you add or change an environment variable, do **Trigger deploy** again, or Jarvis won't see the change.

### 2e. Tell Supabase where Jarvis lives

Back in Supabase:

1. **Authentication** → **URL Configuration**.
2. Set **Site URL** to `https://jarvis-qevero.netlify.app` and click **Save**.

✅ **Part 2 done.** Delete the Notepad note now that everything's in Netlify and your password manager.

---

## Part 3: First login, about 5 minutes

Do this **on your iPhone**.

1. Open **Safari** and go to **https://jarvis-qevero.netlify.app**.
2. Log in with the email and password from 1c.
3. Jarvis shows a **QR code**. Open **Microsoft Authenticator** → **+** → **Other account** → scan the code.
4. Type the 6-digit code from the app into Jarvis.
5. You're in. You'll see the **Today** screen.

**Add Jarvis to your Home Screen:** in Safari tap the **Share** button (square with an arrow) → **Add to Home Screen** → **Add**. From now on, open Jarvis from that icon.

**Check your company details:** open the Jarvis icon → **Business** → **Vault**. Your company number, VAT number and year end are already filled in. Add your registered office address and anything else you have to hand. Check the **first VAT period end date** against your VAT certificate.

---

## Part 4: Connect Jarvis to Claude, about 5 minutes

This is the main event: it lets you *talk* to Jarvis.

1. On your laptop, go to **https://claude.ai** and log in.
2. Click your name (bottom left) → **Settings** → **Connectors**.
3. Click **Add custom connector**:
   - **Name:** `Jarvis`
   - **URL:** `https://jarvis-qevero.netlify.app/api/mcp`
4. Click **Add**, then **Connect**.
5. A Jarvis page opens. Log in (and enter your authenticator code if asked), check it says the request is from **claude.ai**, and click **Approve**.
6. You're back in Claude, and Jarvis shows as connected.

**Also in Claude → Settings**, turn on **Memory** and **Search and reference chats** if you see them. They help Jarvis remember things.

### ✅ The big test

Start a new chat in Claude. Click the **tools/search-and-tools button** (the slider icon by the message box) and make sure **Jarvis** is switched on. Then type:

> What's our VAT number?

Claude may ask permission to use Jarvis the first time. Click **Allow always**. It should answer **GB531607691**.

Now try it on your **iPhone**: open the Claude app (Jarvis is already connected because it's the same account), tap the **voice** button and ask the same question out loud. 🎉

---

## Part 5: Notifications and Siri, about 5 minutes

**Notifications** (morning briefing at 07:00, tax deadlines, Sunday review):

1. Open **Jarvis from the Home Screen icon**. It must be the icon, not Safari.
2. Tap the **cog** (top right) to open **Settings** → **Connections** tab → scroll to notifications → **Enable notifications** → **Allow**.
3. Tap **Send a test notification**. You should get one within a few seconds.

**"Hey Siri, Jarvis":**

1. Open the **Shortcuts** app → **+** (top right).
2. **Add Action** → search **Claude** → choose **Open App** (or "Ask Claude" if you prefer typing).
3. Tap the name at the top → **Rename** → `Jarvis` → **Done**.
4. Now say **"Hey Siri, Jarvis"** and Claude opens. Tap the voice button and talk.

**Action Button** (iPhone 15 Pro or newer): **Settings** app → **Action Button** → swipe to **Shortcut** → choose **Jarvis**. Hold the button and Claude opens.

✅ **Jarvis is now working.** Everything below adds more abilities. Do them whenever you like, in any order.

---

## Part 6: Xero (revenue, invoices, VAT), about 10 minutes

1. On your laptop go to **https://developer.xero.com** → **Log in** (use your normal Xero login) → **My Apps** → **New app**.
2. Fill in:
   - **App name:** `Jarvis Qevero`
   - **Integration type:** **Web app**
   - **Company or application URL:** `https://qevero.com`
   - **Redirect URI:** `https://jarvis-qevero.netlify.app/api/integrations/xero/callback`
3. Tick the terms and click **Create app**.
4. Click **Configuration** on the left:
   - Copy the **Client id**.
   - Click **Generate a secret** and copy it. **This is shown only once**, so save it in your password manager.
5. In Netlify, add two environment variables, then **Trigger deploy**:
   - `XERO_CLIENT_ID` = the client id
   - `XERO_CLIENT_SECRET` = the secret
6. When it's published, open Jarvis → **Settings** → **Connections** → **Connect Xero** → choose **Qevero Ltd** → **Allow access**.
7. Still in Settings, click **Create "Revenue Stream" tracking category**. This sets up your five revenue streams in Xero for you.

✅ **Test:** ask Claude "How's revenue this month?"

---

## Part 7: Outlook, calendar and To Do, about 15 minutes

This is the fiddliest part, because Microsoft's website is busy. Take it slowly.

1. Go to **https://portal.azure.com** and sign in with **qevero@outlook.com**.
   - If it says you need an Azure account, choose the **free** account sign-up. It may ask for a card **to verify your identity only**. You won't be charged as long as you don't upgrade.
2. In the search bar at the top, type **App registrations** and click it.
3. Click **+ New registration**:
   - **Name:** `Jarvis`
   - **Supported account types:** **Personal Microsoft accounts only**
   - **Redirect URI:** choose **Web** in the dropdown, then type `https://jarvis-qevero.netlify.app/api/integrations/microsoft/callback`
   - Click **Register**.
4. On the page that opens, copy the **Application (client) ID**.
5. Left menu → **Certificates & secrets** → **+ New client secret** → Expires: **24 months** → **Add**.
   - Copy the **Value** column (not the "Secret ID") **straight away**, because it hides after you leave the page.
   - Put a reminder in your calendar for 23 months' time: "Renew Jarvis Microsoft secret".
6. Left menu → **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**. Search for and tick each of these:
   - `offline_access`
   - `openid`
   - `email`
   - `User.Read`
   - `Tasks.ReadWrite`
   - `Calendars.ReadWrite`
   - `Mail.ReadWrite`

   Then click **Add permissions**. Do **not** add `Mail.Send`; Jarvis is only allowed to draft emails, never send them.
7. In Netlify, add these two environment variables, then **Trigger deploy**:
   - `MICROSOFT_CLIENT_ID` = the Application (client) ID
   - `MICROSOFT_CLIENT_SECRET` = the secret **Value**
8. Jarvis → **Settings** → **Connections** → **Connect Microsoft** → sign in as qevero@outlook.com → **Accept**.

✅ **Test:** ask Claude "What's on tomorrow?" or "Add a task to chase World of Beds on Friday".

---

## Part 8: Your iPhone shortcuts (health, sharing, messages), about 20 minutes

### 8a. Make your iPhone's key

1. Jarvis → **cog** (Settings) → **Devices** tab → name it `iPhone`. Leave all four boxes ticked → **Create token**.
2. Copy the token (it starts `jv_`). Paste it into a note on your iPhone for now. You'll paste it into the shortcuts below, then you can delete the note.

### 8b. Set up the shortcuts

These have step-by-step instructions in **[IPHONE-SHORTCUTS.md](IPHONE-SHORTCUTS.md)**. Open that page on your iPhone and follow along in the Shortcuts app:

- **§2 Jarvis Health Sync:** sends your MyFitnessPal calories, protein and weight to Jarvis every night. First, in MyFitnessPal: **Settings → Sharing & Privacy → Apple Health** → allow it to write nutrition and weight.
- **§5 Send to Jarvis:** adds Jarvis to the Share button in every app (links, notes, WhatsApp chats).
- **§6 / [MESSAGES.md](MESSAGES.md):** forwards iMessages from people you choose.

**Using WhatsApp with Jarvis:** in WhatsApp, open a chat → tap the name at the top → **Export Chat** → **Without Media** → **Send to Jarvis**. Then ask Claude "what did I miss in that chat?"

### 8c. Your goals and Hevy

- Jarvis → **Settings** → **Personal**: set your calorie target, protein target, target weight, workouts per week and home town (for the weather).
- **Hevy:** if you have **Hevy Pro**, open Hevy → **Settings → Developer** → copy the API key → paste it into Jarvis **Settings → Personal → Hevy**. Without Pro, turn on Hevy → Settings → **Apple Health** instead.

---

## Part 9: The Qevero CRM, about 10 minutes

This lets Jarvis *read* the CRM (pipeline, leads, tasks, tenders). It can never change anything there.

1. Open **https://jarvis-qevero.netlify.app/setup-keys.html** again. It makes **new** keys each time, which is fine: here you only need the **CRM** section at the bottom.
2. Go to **Supabase** and switch to the **CRM's project** (not the Jarvis one; use the project picker at the top).
3. **SQL Editor** → **New query**. Open [`jarvis_connector.sql`](https://github.com/Qevero/Jarvis/blob/main/integrations/qevero-crm/jarvis_connector.sql), click **Copy raw file**, paste it in and click **Run**.
4. **New query** again. Copy the **"SQL to run in the CRM's Supabase"** box from the keys page, paste it in and click **Run**.
5. In the CRM's Supabase: **Project Settings** → **Data API** for its **Project URL**, and **API Keys** for its **publishable key**.
6. In Netlify (the **Jarvis** site), add these three environment variables, then **Trigger deploy**:
   - `CRM_SUPABASE_URL` = the CRM's Project URL
   - `CRM_SUPABASE_PUBLISHABLE_KEY` = the CRM's publishable key
   - `CRM_CONNECTOR_TOKEN` = the **CRM_CONNECTOR_TOKEN** from the keys page

✅ **Test:** ask Claude "What's in the pipeline?"

---

## Part 10: Teach Jarvis what you've told Claude before, about 10 minutes

1. **https://claude.ai** → **Settings** → **Privacy** → **Export data**. Anthropic emails you a download link (it can take a while).
2. Download the zip to your laptop. **Don't unzip it.**
3. Jarvis → **Life** → **Memory** → **Import Claude chat history** → choose the zip.
4. In Claude (with Jarvis on), say:

   > Go through my undigested past chats and remember anything important about Qevero, clients, pricing and how I like to work.

---

## Part 11: Ask your accountant

Jarvis has worked out your tax deadlines, but they show an **"unverified"** badge until your accountant confirms them. Send your accountant the list from Jarvis → **Business** → **Tax**. When they're happy, tick each one as verified.

---

## Where am I? The Setup page

On the **Today** screen, tap the **"Finish setting up Jarvis"** banner (or search for **Setup**). It shows a checklist that **ticks itself off** as each part starts working. If something isn't ticked, that part isn't connected yet.

## If something goes wrong

| What you see | What to do |
|---|---|
| Jarvis website shows "Application error" or "Missing environment variable…" | A Netlify variable is missing or misspelt. Check Part 2c (names are case-sensitive), then **Trigger deploy**. |
| You changed a setting in Netlify and nothing happened | You need to **Trigger deploy** after every change. |
| Login says invalid email or password | Check the user exists in Supabase → Authentication → Users, and that `JARVIS_OWNER_EMAIL` matches it exactly. |
| Lost your authenticator / new phone | Supabase → Authentication → Users → click your user → remove the MFA factor. Next login asks you to scan a new QR code. |
| Claude says it can't connect to Jarvis | Check Part 1e (OAuth Server on, path `/oauth/consent`, dynamic apps on) and Part 2e (Site URL). Then remove the connector in Claude and add it again. |
| Claude doesn't use Jarvis | In the chat, open the tools menu and make sure **Jarvis** is switched on. |
| Xero or Microsoft says "redirect URI mismatch" | The Redirect URI you typed in Part 6 or 7 has a typo. It must match exactly, including `https://`. |
| No notifications on iPhone | Open Jarvis from the **Home Screen icon**, not Safari, and turn them on there. iPhone needs iOS 16.4 or later. |
| Health page is empty | Run the Health Sync automation by hand once (tap it in Shortcuts → Run), and check MyFitnessPal is allowed to write to Apple Health. |

Stuck? Open Claude Code on this repository and describe what you see; a screenshot of the error helps. **Don't paste any keys or secrets.**
