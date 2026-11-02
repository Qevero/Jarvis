# Missed messages

Goal: ask Jarvis *"What have I missed?"* and get a summary of the WhatsApp and iMessage messages you haven't caught up on.

## What's possible on an iPhone (no Mac)

- **Apple doesn't let any app read your Messages history**, and iOS doesn't let Shortcuts read notifications.
- **WhatsApp has no API for personal accounts.** Unofficial "WhatsApp Web" tools break WhatsApp's terms and can get your number banned, so Jarvis never uses them.

Within those rules, here is what works today, phone-only, at £0:

| Option | Covers | Effort | Quality |
|---|---|---|---|
| **A. "Send to Jarvis" a WhatsApp chat** | Any WhatsApp chat or group | Two taps per chat when you want a catch-up | Good on demand; you choose when |
| **B. iMessage automation** | iMessage/SMS from people you choose | Set up once | Automatic for those people |
| **C. Mac bridge** (when you get a MacBook) | All WhatsApp + iMessage + SMS, unread only | Set up once, ~10 min | Best: fully automatic, knows what you've read |

> **Windows laptop:** WhatsApp for Windows encrypts its local database, so a Windows bridge isn't possible. Option C is ready and waiting for the MacBook.

### A. Share a WhatsApp chat to Jarvis

Set up **Send to Jarvis** once ([IPHONE-SHORTCUTS.md §5](IPHONE-SHORTCUTS.md#5-send-to-jarvis-share-sheet)). Then whenever you're behind:

1. In WhatsApp, open the chat → tap its name → **Export Chat** → **Without Media** → **Send to Jarvis**.
2. You'll get a notification like "Jarvis has 42 messages from 5-a-side (last 7 days)".
3. Ask Claude: *"What did I miss in 5-a-side?"* or *"Anything I need to reply to?"*

Only other people's messages are kept (not yours), from the last 7 days. Sharing the same chat again only adds new messages.

### B. iMessage automation (chosen people)

1. Use your iPhone device token (Settings → **Devices**). It needs the **messages** permission.
2. **Shortcuts → Automation → + → Message.**
3. Under **Sender**, choose the people who matter most (family, key clients). iOS asks you to pick senders or a word the message contains.
4. Choose **Run Immediately**, then **New Blank Automation**.
5. Add **Get Contents of URL**:
   - URL: `https://jarvis-qevero.netlify.app/api/ingest/messages`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer jv_…`
   - Request Body: **JSON**, with three keys:
     - `source` = `imessage`
     - `sender` = **Shortcut Input → Sender**
     - `text` = **Shortcut Input → Content**
6. Turn off **Notify When Run**. Repeat for other people if you like.

This forwards every message from those people, even ones you've read, so mark them seen in Jarvis (or ask Claude to) once you're caught up.

### C. Mac bridge (later)

See [`desktop/bridge/README.md`](../desktop/bridge/README.md). It reads the Messages and WhatsApp-desktop databases on your own Mac every 5 minutes. It forwards only unread messages and notices when you've read them on your phone.

## Privacy

- Message text is encrypted (AES-256-GCM) and automatically deleted after your retention period. The default is 14 days; change it in Settings → Personal.
- Only you can see it, behind your password and MFA.
- Claude reads messages only when you ask.
- Jarvis can't reply or send messages.
- Revoke a device token any time in Settings → Devices.
