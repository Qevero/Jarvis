import webpush from "web-push";
import { env } from "@/lib/env";
import type { Ctx } from "@/lib/ctx";

/** Web Push to the installed Jarvis app (free, VAPID; iOS 16.4+ home-screen apps). */

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export async function sendPush(ctx: Ctx, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  const vapid = env.vapid();
  if (!vapid) return { sent: 0, removed: 0 };
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const { data: subs } = await ctx.sb.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("owner_id", ctx.ownerId);
  let sent = 0, removed = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await ctx.sb.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      }
    }
  }
  return { sent, removed };
}
