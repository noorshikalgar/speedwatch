import { getSetting } from './db.js';

type NotificationEvent = 'site_down' | 'site_slow' | 'speed_low';

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
  } catch (err) {
    console.error('[notifications] webhook failed:', err);
  }
}
