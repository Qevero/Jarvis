# Missed messages: what's possible and how to set it up

Goal: ask Jarvis *"What have I missed?"* and get a summary of unread WhatsApp, iMessage and SMS messages.

## The honest constraints

- **Apple gives no app access to your Messages on iPhone.** There's no API, and iOS doesn't let Shortcuts read your message history or notifications.
- **WhatsApp has no API for personal accounts.** The WhatsApp Business API is only for business numbers messaging customers. Unofficial "WhatsApp Web" libraries break WhatsApp's terms and risk your number being banned, so Jarvis doesn't use them.

## What works

| Option | Covers | Needs | Quality |
|---|---|---|---|
| **A. Mac bridge** (recommended) | WhatsApp, iMessage, SMS | A Mac that's on and awake for part of the day, the WhatsApp desktop app, Messages in iCloud | Best: true "unread" tracking; read-on-phone syncs back |
| **B. iPhone automation** | iMessage/SMS from chosen people | iOS 17+, Shortcuts | Partial: forwards every message from those people, read or not; no WhatsApp |
| **C. Manual export** | One WhatsApp chat | WhatsApp → chat → Export chat → Files, then ask Claude to read it | Ad hoc only |

### A. Mac bridge

See [`desktop/bridge/README.md`](../desktop/bridge/README.md). It takes about 10 minutes, and once running it's automatic every 5 minutes.

### B. iPhone automation (iMessage only)

1. Jarvis → Settings → Personal → Device tokens → create `iPhone messages` with the **messages** permission. Copy the token.
2. **Shortcuts → Automation → + → Message.**
3. Under **Sender**, choose the people you most care about (family, key clients). iOS asks you to pick senders or a word the message contains.
4. Choose **Run Immediately**, then **New Blank Automation**.
5. Add **Get Contents of URL**:
   - URL: `https://jarvis-qevero.netlify.app/api/ingest/messages`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer jv_…` (your token)
   - Request Body: **JSON**, with three keys:
     - `source` (Text) = `imessage`
     - `sender` = tap **Shortcut Input** and choose **Sender**
     - `text` = **Shortcut Input → Content**
6. Turn on **Run Immediately** / turn off **Notify When Run**.

Repeat for other people if you like. Messages arrive in Jarvis → **Messages**.

## Privacy

- Message text is encrypted (AES-256-GCM) before it's stored and automatically deleted after your retention period. Change it in Settings → Personal; the default is 14 days.
- Only you can see it, behind your password and MFA.
- Claude reads messages only when you ask (`get_missed_messages`).
- Jarvis can't reply or send messages.
- Revoke a device token any time in Settings.
