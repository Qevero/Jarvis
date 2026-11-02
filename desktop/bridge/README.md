# Jarvis Mac bridge (missed WhatsApp, iMessage and SMS)

This is a small script that runs on **your Mac** every 5 minutes. It forwards messages you **haven't read yet** to Jarvis, so you can ask Claude *"what have I missed?"* and get a summary.

- **iMessage and SMS:** read from the Messages app's local database. With "Messages in iCloud" on, your Mac has the same messages as your iPhone. To include SMS, turn on iPhone → Settings → Messages → **Text Message Forwarding** → your Mac.
- **WhatsApp:** read from the **WhatsApp desktop app's** local database. Install WhatsApp from the Mac App Store and link it to your phone.
- **Read only, local only.** It never signs in to WhatsApp or Apple, never sends anything, and uses no third-party packages.
- **What it forwards:** unread incoming text messages only. When you later read a chat on your phone, the bridge tells Jarvis, so it stops counting as missed.
- **How it's stored:** encrypted in Jarvis and deleted after your retention period (14 days by default).

> **WhatsApp note:** this reads the database the official WhatsApp desktop app keeps on your Mac. It doesn't use an unofficial WhatsApp client (those break WhatsApp's terms and can get your number banned). WhatsApp may change the database layout in an update. If that happens, the bridge skips WhatsApp and prints a warning, and iMessage carries on working.

## Set up (about 10 minutes)

1. **Create a device token:** Jarvis → Settings → Personal → Device tokens → name it `MacBook`, tick **messages** only → **Create token** → copy it.
2. **Get the script:** clone or download this repo to your Mac, e.g. `~/Jarvis`.
3. **Grant Full Disk Access:** System Settings → Privacy & Security → **Full Disk Access** → **+**, then add **Terminal** (for testing) and `/usr/bin/python3`. You may need ⌘⇧G to type the path.
4. **Test it.** This prints what would be sent and sends nothing:

   ```bash
   python3 ~/Jarvis/desktop/bridge/jarvis_bridge.py --dry-run
   ```

5. **Run it for real once:**

   ```bash
   export JARVIS_URL="https://jarvis-qevero.netlify.app"
   ```

   ```bash
   export JARVIS_TOKEN="jv_..."
   ```

   ```bash
   python3 ~/Jarvis/desktop/bridge/jarvis_bridge.py
   ```

   You should see `forwarded N new`. The first run only looks back 24 hours.
6. **Run it every 5 minutes automatically:**
   1. Edit `com.qevero.jarvis-bridge.plist`: set the script path and your token.
   2. Copy it into place:

      ```bash
      cp ~/Jarvis/desktop/bridge/com.qevero.jarvis-bridge.plist ~/Library/LaunchAgents/
      ```

   3. Load it:

      ```bash
      launchctl load ~/Library/LaunchAgents/com.qevero.jarvis-bridge.plist
      ```

   It runs whenever your Mac is awake. Logs go to `/tmp/jarvis-bridge.log`.

**Options:**
- `--no-whatsapp`, `--no-imessage`: forward only one source.
- `--include-read`: also forward iMessages you've already read.
- `--retention-days 7`: keep messages for a shorter time.

**Stop it:**

```bash
launchctl unload ~/Library/LaunchAgents/com.qevero.jarvis-bridge.plist
```

Then revoke the token in Jarvis.
