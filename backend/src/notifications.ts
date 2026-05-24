import { getSetting } from './db.js';

type NotificationEvent = 'site_down' | 'site_slow' | 'speed_low';
const lastSent = new Map<string, number>();

function enabledFor(event: NotificationEvent) {
  if (getSetting('notifications_enabled') !== 'true') return false;
  if (!getSetting('notification_webhook_url')) return false;
  if (event === 'site_down') return getSetting('notify_site_down') !== 'false';
  if (event === 'site_slow') return getSetting('notify_site_slow') !== 'false';
  if (event === 'speed_low') return getSetting('notify_speed_low') !== 'false';
  return true;
}

export async function sendNotification(event: NotificationEvent, message: string, details: Record<string, unknown> = {}) {
  if (!enabledFor(event)) return;

  const url = getSetting('notification_webhook_url');
  if (!url) return;
  const cooldownMinutes = Math.max(0, Number(getSetting('alert_cooldown_minutes') ?? '30'));
  const key = `${event}:${details.site_id ?? details.provider ?? 'global'}`;
  const now = Date.now();
  const previous = lastSent.get(key) ?? 0;
  if (cooldownMinutes > 0 && now - previous < cooldownMinutes * 60_000) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        content: message,
        text: message,
        message,
        details,
      }),
    });
    lastSent.set(key, now);
  } catch (err) {
    console.error('[notifications] webhook failed:', err);
  }
}
