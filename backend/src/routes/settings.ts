import { Router } from 'express';
import { getAllSettings, setSetting } from '../db.js';
import { restartScheduler } from '../scheduler.js';
import { normalizeSpeedTestProvider } from '../speedtest.js';

const router = Router();
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function normalizeTimezone(value: unknown): string {
  const timezone = String(value ?? '').trim();
  if (timezone === 'Asia/Kolkatta') return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

router.get('/', (_req, res) => {
  const raw = getAllSettings();
  res.json({
    plan_download_mbps: parseFloat(raw.plan_download_mbps ?? '100'),
    plan_upload_mbps: parseFloat(raw.plan_upload_mbps ?? '50'),
    test_interval_minutes: parseInt(raw.test_interval_minutes ?? '120', 10),
    retention_days: parseInt(raw.retention_days ?? '90', 10),
    alert_threshold_pct: parseInt(raw.alert_threshold_pct ?? '20', 10),
    display_timezone: normalizeTimezone(raw.display_timezone ?? DEFAULT_TIMEZONE),
    speed_test_provider: normalizeSpeedTestProvider(raw.speed_test_provider ?? 'cloudflare'),
    speed_test_auto_round_robin: raw.speed_test_auto_round_robin === 'true',
    librespeed_server_url: raw.librespeed_server_url ?? '',
    notifications_enabled: raw.notifications_enabled === 'true',
    notification_webhook_url: raw.notification_webhook_url ?? '',
    notify_site_down: raw.notify_site_down !== 'false',
    notify_site_slow: raw.notify_site_slow !== 'false',
    notify_speed_low: raw.notify_speed_low !== 'false',
    public_status_enabled: raw.public_status_enabled === 'true',
    latency_sites: JSON.parse(raw.latency_sites ?? '[]'),
  });
});

router.put('/', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const allowedNumbers = ['plan_download_mbps', 'plan_upload_mbps', 'test_interval_minutes', 'retention_days', 'alert_threshold_pct'];
  const intervalChanged = body.test_interval_minutes !== undefined;

  for (const key of allowedNumbers) {
    if (body[key] !== undefined) {
      let val = parseFloat(String(body[key]));
      if (key === 'retention_days') val = Math.min(180, Math.max(1, val));
      setSetting(key, String(val));
    }
  }

  if (body.latency_sites !== undefined && Array.isArray(body.latency_sites)) {
    setSetting('latency_sites', JSON.stringify(body.latency_sites));
  }

  if (body.display_timezone !== undefined) {
    setSetting('display_timezone', normalizeTimezone(body.display_timezone));
  }

  if (body.speed_test_provider !== undefined) {
    setSetting('speed_test_provider', normalizeSpeedTestProvider(body.speed_test_provider));
  }

  if (body.speed_test_auto_round_robin !== undefined) {
    setSetting('speed_test_auto_round_robin', body.speed_test_auto_round_robin ? 'true' : 'false');
  }

  if (body.librespeed_server_url !== undefined) {
    setSetting('librespeed_server_url', String(body.librespeed_server_url ?? '').trim());
  }

  for (const key of ['notifications_enabled', 'notify_site_down', 'notify_site_slow', 'notify_speed_low', 'public_status_enabled']) {
    if (body[key] !== undefined) setSetting(key, body[key] ? 'true' : 'false');
  }

  if (body.notification_webhook_url !== undefined) {
    setSetting('notification_webhook_url', String(body.notification_webhook_url ?? '').trim());
  }

  if (intervalChanged) restartScheduler();

  res.json({ success: true });
});

export default router;
