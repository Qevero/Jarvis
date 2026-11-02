#!/usr/bin/env python3
"""
Jarvis Mac bridge — forwards messages you haven't read yet to Jarvis so Claude
can summarise what you've missed.

Reads ONLY local databases on your own Mac (read-only):
  • iMessage + SMS:  ~/Library/Messages/chat.db           (Messages app, synced via iCloud)
  • WhatsApp:        ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite
                     (the WhatsApp desktop app from the Mac App Store, linked to your phone)

It never logs into WhatsApp or Apple, never sends anything, and needs no
third-party packages. Message text goes to Jarvis over HTTPS and is stored
encrypted, then deleted after your retention period.

Usage:
    export JARVIS_URL="https://jarvis-qevero.netlify.app"
    export JARVIS_TOKEN="jv_..."          # device token with the "messages" permission
    python3 jarvis_bridge.py              # one run (schedule it every 5 min with launchd)
    python3 jarvis_bridge.py --dry-run    # print what would be sent

Needs Full Disk Access for the Python/Terminal that runs it (System Settings →
Privacy & Security → Full Disk Access). See README.md in this folder.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sqlite3
import sys
import urllib.request

HOME = os.path.expanduser("~")
IMESSAGE_DB = os.path.join(HOME, "Library/Messages/chat.db")
WHATSAPP_DB = os.path.join(HOME, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite")
ADDRESSBOOK_GLOB = os.path.join(HOME, "Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb")
STATE_FILE = os.path.join(HOME, ".jarvis-bridge.json")
APPLE_EPOCH = dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc)
FIRST_RUN_HOURS = 24
TRACK_LIMIT = 1000


def ro(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def apple_time(v):
    if v is None:
        return None
    v = float(v)
    if v > 1e12:  # nanoseconds (modern chat.db)
        v = v / 1e9
    return (APPLE_EPOCH + dt.timedelta(seconds=v)).isoformat()


def apple_seconds_ago(hours):
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours) - APPLE_EPOCH).total_seconds()


def decode_attributed_body(blob):
    """Newer macOS stores message text in an archived NSAttributedString."""
    if not blob:
        return None
    try:
        part = bytes(blob).split(b"NSString", 1)[1][5:]
        if part[0] == 0x81:
            length, start = int.from_bytes(part[1:3], "little"), 3
        elif part[0] == 0x82:
            length, start = int.from_bytes(part[1:4], "little"), 4
        else:
            length, start = part[0], 1
        return part[start:start + length].decode("utf-8", errors="replace")
    except Exception:
        return None


def digits(s):
    d = re.sub(r"\D", "", s or "")
    return d[-10:] if len(d) >= 10 else d


def contact_names():
    """Phone/email → name from the macOS Contacts database (best effort)."""
    names = {}
    for path in glob.glob(ADDRESSBOOK_GLOB):
        try:
            con = ro(path)
            for first, last, org, num in con.execute(
                "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, p.ZFULLNUMBER FROM ZABCDRECORD r JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK"
            ):
                name = " ".join(x for x in (first, last) if x) or org
                if name and num:
                    names[digits(num)] = name
            for first, last, org, email in con.execute(
                "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, e.ZADDRESS FROM ZABCDRECORD r JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK"
            ):
                name = " ".join(x for x in (first, last) if x) or org
                if name and email:
                    names[email.lower()] = name
            con.close()
        except Exception:
            continue
    return names


def name_for(handle, names):
    if not handle:
        return None
    return names.get(handle.lower()) or names.get(digits(handle)) or handle


# ─── iMessage / SMS ──────────────────────────────────────────────────────────
def read_imessage(state, names, only_unread):
    if not os.path.exists(IMESSAGE_DB):
        return [], []
    con = ro(IMESSAGE_DB)
    last = state.get("imessage_rowid")
    if last is None:
        cutoff_ns = int(apple_seconds_ago(FIRST_RUN_HOURS) * 1e9)
        where, params = "m.date > ?", [cutoff_ns]
    else:
        where, params = "m.ROWID > ?", [last]
    rows = con.execute(
        f"""SELECT m.ROWID, m.guid, m.text, m.attributedBody, m.date, m.is_read, m.service, h.id,
                   c.display_name, c.chat_identifier,
                   (SELECT COUNT(*) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID)
            FROM message m
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            LEFT JOIN chat c ON c.ROWID = cmj.chat_id
            WHERE {where} AND m.is_from_me = 0 AND m.item_type = 0
            ORDER BY m.ROWID LIMIT 2000""",
        params,
    ).fetchall()
    out, max_rowid = [], last or 0
    for rowid, guid, text, body, date, is_read, service, handle, display, chat_id, members in rows:
        max_rowid = max(max_rowid, rowid)
        text = text or decode_attributed_body(body)
        if not text or (only_unread and is_read):
            continue
        sender = name_for(handle, names)
        group = (members or 0) > 1
        out.append({
            "source": "sms" if (service or "").upper() == "SMS" else "imessage",
            "external_id": guid,
            "chat": display or (chat_id if group else sender),
            "sender": sender,
            "is_group": group,
            "sent_at": apple_time(date),
            "text": text.replace("￼", "[attachment]").strip(),
        })
    # Which previously forwarded messages have since been read (on iPhone or Mac)?
    tracked = [t for t in state.get("tracked", []) if t["source"] in ("imessage", "sms")]
    read = []
    if tracked:
        guids = [t["external_id"] for t in tracked]
        for i in range(0, len(guids), 500):
            chunk = guids[i:i + 500]
            q = f"SELECT guid FROM message WHERE is_read = 1 AND guid IN ({','.join('?' * len(chunk))})"
            read += [{"source": t["source"], "external_id": g} for (g,) in con.execute(q, chunk) for t in tracked if t["external_id"] == g]
    state["imessage_rowid"] = max_rowid if rows or last is not None else con.execute("SELECT IFNULL(MAX(ROWID),0) FROM message").fetchone()[0]
    con.close()
    return out, read


# ─── WhatsApp (desktop app's local database) ─────────────────────────────────
def columns(con, table):
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def read_whatsapp(state):
    if not os.path.exists(WHATSAPP_DB):
        return [], []
    con = ro(WHATSAPP_DB)
    mcols = columns(con, "ZWAMESSAGE")
    if not {"Z_PK", "ZTEXT", "ZMESSAGEDATE", "ZISFROMME", "ZCHATSESSION"} <= mcols:
        print("WhatsApp database layout not recognised — skipping WhatsApp.", file=sys.stderr)
        return [], []
    has_member = "ZGROUPMEMBER" in mcols and "ZWAGROUPMEMBER" in {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    member_sel = "gm.ZCONTACTNAME" if has_member else "NULL"
    member_join = "LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER" if has_member else ""
    stanza = "m.ZSTANZAID" if "ZSTANZAID" in mcols else "CAST(m.Z_PK AS TEXT)"
    last = state.get("whatsapp_pk")
    where, params = ("m.Z_PK > ?", [last]) if last is not None else ("m.ZMESSAGEDATE > ?", [apple_seconds_ago(FIRST_RUN_HOURS)])
    rows = con.execute(
        f"""SELECT m.Z_PK, {stanza}, m.ZTEXT, m.ZMESSAGEDATE, s.ZPARTNERNAME, s.ZSESSIONTYPE, s.ZUNREADCOUNT, {member_sel}, s.Z_PK
            FROM ZWAMESSAGE m
            JOIN ZWACHATSESSION s ON s.Z_PK = m.ZCHATSESSION
            {member_join}
            WHERE {where} AND m.ZISFROMME = 0
            ORDER BY m.Z_PK LIMIT 2000""",
        params,
    ).fetchall()
    out, max_pk = [], last or 0
    for pk, stanza_id, text, date, partner, session_type, unread, member, session_pk in rows:
        max_pk = max(max_pk, pk)
        if not text or not unread:  # chat already read on the phone → not "missed"
            continue
        group = session_type == 1
        out.append({
            "source": "whatsapp",
            "external_id": f"wa:{stanza_id}",
            "chat": partner,
            "sender": (member or "Someone") if group else partner,
            "is_group": group,
            "sent_at": apple_time(date),
            "text": text.strip(),
            "_session": session_pk,
        })
    # Previously forwarded WhatsApp messages in chats now fully read → mark read.
    tracked = [t for t in state.get("tracked", []) if t["source"] == "whatsapp"]
    read = []
    if tracked:
        unread_by_session = dict(con.execute("SELECT Z_PK, ZUNREADCOUNT FROM ZWACHATSESSION"))
        read = [{"source": "whatsapp", "external_id": t["external_id"]} for t in tracked if not unread_by_session.get(t.get("session"), 0)]
    state["whatsapp_pk"] = max_pk if rows or last is not None else con.execute("SELECT IFNULL(MAX(Z_PK),0) FROM ZWAMESSAGE").fetchone()[0]
    con.close()
    return out, read


def post(url, token, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "jarvis-bridge/1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-read", action="store_true", help="Forward iMessages even if already read")
    ap.add_argument("--no-whatsapp", action="store_true")
    ap.add_argument("--no-imessage", action="store_true")
    ap.add_argument("--retention-days", type=int, default=int(os.environ.get("JARVIS_RETENTION_DAYS", "14")))
    args = ap.parse_args()

    url, token = os.environ.get("JARVIS_URL", "").rstrip("/"), os.environ.get("JARVIS_TOKEN", "")
    if not args.dry_run and (not url or not token):
        sys.exit("Set JARVIS_URL and JARVIS_TOKEN (a device token with the 'messages' permission).")

    state = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
    names = contact_names()
    msgs, read = [], []
    try:
        if not args.no_imessage:
            m, r = read_imessage(state, names, not args.include_read)
            msgs += m
            read += r
        if not args.no_whatsapp:
            m, r = read_whatsapp(state)
            msgs += m
            read += r
    except sqlite3.OperationalError as e:
        sys.exit(f"Can't read the message databases ({e}). Grant Full Disk Access — see README.md.")

    if args.dry_run:
        print(json.dumps({"messages": msgs, "read": read}, indent=2, ensure_ascii=False))
        return

    endpoint = f"{url}/api/ingest/messages?retention_days={args.retention_days}"
    sent = 0
    for i in range(0, max(len(msgs), 1), 200):
        batch = [{k: v for k, v in m.items() if not k.startswith("_")} for m in msgs[i:i + 200]]
        res = post(endpoint, token, {"messages": batch, "read": read if i == 0 else []})
        sent += res.get("accepted", 0)

    read_ids = {(r["source"], r["external_id"]) for r in read}
    tracked = [t for t in state.get("tracked", []) if (t["source"], t["external_id"]) not in read_ids]
    tracked += [{"source": m["source"], "external_id": m["external_id"], "session": m.get("_session")} for m in msgs]
    state["tracked"] = tracked[-TRACK_LIMIT:]
    state["last_run"] = dt.datetime.now(dt.timezone.utc).isoformat()
    json.dump(state, open(STATE_FILE, "w"))
    os.chmod(STATE_FILE, 0o600)
    print(f"{dt.datetime.now():%d/%m/%Y %H:%M} forwarded {sent} new, marked {len(read)} read")


if __name__ == "__main__":
    main()
