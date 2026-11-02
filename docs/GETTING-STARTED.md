# Getting started with Jarvis

Jarvis is your personal assistant for both sides of life: **Qevero** (money, clients, invoices, tax, CRM, tasks) and **you** (health, training, weather, missed messages, and anything you want it to remember).

## How you'll use it

| Where | How | Best for |
|---|---|---|
| **Claude on your iPhone** | Action Button or "Hey Siri, Jarvis" → tap voice | Talking to Jarvis hands-free: "morning briefing", "what have I missed?", "add a task to chase World of Beds on Friday", "how's my protein this week?" |
| **Claude on your Mac/PC** | Claude desktop app (optionally "Hey Jarvis" wake word) | Longer work: proposals, invoices, reviewing revenue, journalling |
| **Jarvis app** (`https://jarvis-qevero.netlify.app`) | Home Screen icon on iPhone; browser on desktop | Seeing everything at a glance: briefing, charts, deadlines, messages, health. Also notifications. |
| **Notifications** | Automatic | 07:00 briefing, deadline reminders |

Behind the scenes, your **iPhone** sends MyFitnessPal and weight data each night, your **Mac** forwards unread messages every 5 minutes, and Jarvis syncs **Xero**, **Outlook/To Do**, **Hevy** and your **CRM** on its own.

## What you need to do, in order

Steps 1–4 get Jarvis running (about 45 minutes). Everything after that adds a feature and can be done any time.

| # | Step | Time | Guide |
|---|---|---|---|
| 1 | Create a **Supabase** project (London) and run the 3 migration files | 15 min | README → Setup → 1 |
| 2 | Link the **Netlify** project `jarvis-qevero` to GitHub `Qevero/Jarvis`; add the environment variables; deploy | 10 min | README → Setup → 2 |
| 3 | Open `https://jarvis-qevero.netlify.app`, sign in, set up MFA, check the **Vault** | 5 min | README → Setup → 3 |
| 4 | Add Jarvis as a **custom connector** in Claude and approve it; ask "What's our VAT number?" | 5 min | README → Setup → 4 |
| 5 | **Xero**: create the app, connect, create the "Revenue Stream" category | 10 min | README → Setup → 5 |
| 6 | **Outlook / Calendar / To Do**: Entra app registration, then connect | 15 min | README → Setup → 6 |
| 7 | **CRM**: run the connector SQL in the CRM's Supabase and add 3 variables | 10 min | README → Setup → 7 |
| 8 | **Notifications**: VAPID keys, then enable on your iPhone | 5 min | README → Setup → 8 |
| 9 | **Health**: allow MyFitnessPal → Apple Health; create the "Jarvis Health Sync" automation; set goals in Settings → Personal | 15 min | `docs/IPHONE-SHORTCUTS.md` |
| 10 | **Hevy**: paste your API key (needs Hevy Pro), or use Apple Health | 2 min | `docs/IPHONE-SHORTCUTS.md` §3 |
| 11 | **Messages**: Mac bridge for WhatsApp, iMessage and SMS (or the iPhone automation for iMessage) | 10 min | `docs/MESSAGES.md` |
| 12 | **Memory**: import your Claude chat history, then ask Claude to digest it | 10 min | README → Setup → 10 |
| 13 | **Siri, Action Button, Home Screen** | 5 min | `docs/IPHONE-SHORTCUTS.md` §1, §4 |
| 14 | Ask your accountant to confirm the tax rules, then mark them verified on the Tax page | — | Tax page |

**No setup needed:**
- **Weather** comes from Open-Meteo for your home (Norwich by default; change it in Settings → Personal).
- **General web questions** (news, opening hours, prices, research) use **Claude's built-in web search**. Just ask.
- **Other apps** (Google, Notion and so on): check Claude → Settings → **Connectors**. Many official connectors work alongside Jarvis in the same chat.

## Things to say to Jarvis

- "Give me my morning briefing."
- "What have I missed on WhatsApp?" / "Anyone I need to reply to?"
- "How am I doing against my calorie and protein targets this week?" / "Am I on track for my target weight?"
- "How's my bench press progressing?" / "Did I hit any PRs this week?"
- "What's the weather tomorrow?" / "Will it rain in London on Thursday?"
- "Remember that my squat goal is 150 kg by March." / "Remember Dan's birthday is 14/06."
- "Which revenue stream needs attention?" / "How much should I set aside for tax?"
- "Invoice World of Beds £750 for November's SEO retainer." (preview → "yes, create it")
- "Draft an SEO proposal for …" / "Add a task to chase … on Friday" / "What's on tomorrow?"
- "Save this to my journal: …"

## Want something else connected?

Ask. The pattern is always the same: if a service has an API, Jarvis connects to it directly. If an app only writes to **Apple Health** (most fitness apps do), the Health Sync shortcut picks it up. If the data only lives on your phone, an iPhone Shortcut or the Mac bridge can forward it. Anything that would cost money gets flagged before it's added.
