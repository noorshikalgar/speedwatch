import { Router } from 'express';
import { getAllSettings, setSetting } from '../db.js';
import { restartScheduler } from '../scheduler.js';
import { normalizeSpeedTestProvider } from '../speedtest.js';

const router = Router();
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function isHttpUrl(value: unknown, allowEmpty = false): boolean {
  const text = String(value ?? '').trim();
  if (!text) return allowEmpty;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

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

function validateTimezone(value: unknown): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(value ?? '') }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseBooleanSetting(value: unknown, fallback: string | undefined) {
  if (value !== undefined) return Boolean(value);
  return fallback === 'true';
}

function validateSettings(body: Record<string, unknown>, raw: Record<string, string>) {
  const errors: Record<string, string> = {};
  const numberRules: Record<string, { min: number; max: number }> = {
    plan_download_mbps: { min: 0.1, max: 100_000 },
    plan_upload_mbps: { min: 0.1, max: 100_000 },
    test_interval_minutes: { min: 1, max: 10_080 },
    retention_days: { min: 1, max: 180 },
    alert_threshold_pct: { min: 5, max: 80 },
    alert_cooldown_minutes: { min: 0, max: 1440 },
    public_status_refresh_seconds: { min: 5, max: 3600 },
  };

  for (const [key, rule] of Object.entries(numberRules)) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < rule.min || value > rule.max) {
      errors[key] = `Must be between ${rule.min} and ${rule.max}.`;
    }
  }

  const provider = body.speed_test_provider !== undefined ? normalizeSpeedTestProvider(body.speed_test_provider) : normalizeSpeedTestProvider(raw.speed_test_provider ?? 'cloudflare');
  const librespeedUrl = body.librespeed_server_url !== undefined ? body.librespeed_server_url : raw.librespeed_server_url ?? '';
  if (provider === 'librespeed' && !isHttpUrl(librespeedUrl)) errors.librespeed_server_url = 'LibreSpeed needs a valid http or https URL.';
  if (String(librespeedUrl ?? '').trim() && !isHttpUrl(librespeedUrl, true)) errors.librespeed_server_url = 'LibreSpeed URL must start with http:// or https://.';

  if (body.latency_sites !== undefined) {
    if (!Array.isArray(body.latency_sites) || body.latency_sites.some(site => !isHttpUrl(site))) {
      errors.latency_sites = 'Every latency monitor URL must start with http:// or https://.';
    }
  }

  const notificationsEnabled = parseBooleanSetting(body.notifications_enabled, raw.notifications_enabled);
  const webhookUrl = body.notification_webhook_url !== undefined ? body.notification_webhook_url : raw.notification_webhook_url ?? '';
  if (notificationsEnabled && !isHttpUrl(webhookUrl)) errors.notification_webhook_url = 'Webhook URL is required when alerts are enabled.';
  if (String(webhookUrl ?? '').trim() && !isHttpUrl(webhookUrl, true)) errors.notification_webhook_url = 'Webhook URL must start with http:// or https://.';

  const publicStatusEnabled = parseBooleanSetting(body.public_status_enabled, raw.public_status_enabled);
  const publicTitle = body.public_status_title !== undefined ? String(body.public_status_title ?? '').trim() : raw.public_status_title ?? '';
  if (publicStatusEnabled && publicTitle.length < 2) errors.public_status_title = 'Status page title is required.';

  if (body.display_timezone !== undefined && !validateTimezone(body.display_timezone)) {
    errors.display_timezone = 'Use a valid IANA timezone.';
  }

  if (body.public_status_site_ids !== undefined && (!Array.isArray(body.public_status_site_ids) || body.public_status_site_ids.some(id => !Number.isFinite(Number(id))))) {
    errors.public_status_site_ids = 'Site IDs must be numbers.';
  }

  return errors;
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
    alert_cooldown_minutes: parseInt(raw.alert_cooldown_minutes ?? '30', 10),
    public_status_enabled: raw.public_status_enabled === 'true',
    public_status_title: raw.public_status_title ?? 'SpeedWatch Status',
    public_status_message: raw.public_status_message ?? '',
    public_status_show_latency: raw.public_status_show_latency !== 'false',
    public_status_show_speed: raw.public_status_show_speed !== 'false',
    public_status_show_latency_summary: raw.public_status_show_latency_summary !== 'false',
    public_status_site_ids: JSON.parse(raw.public_status_site_ids ?? '[]'),
    public_status_refresh_seconds: parseInt(raw.public_status_refresh_seconds ?? '60', 10),
    github_star_enabled: raw.github_star_enabled !== 'false',
    github_repo_url: raw.github_repo_url ?? 'https://github.com/noorshikalgar/speedwatch',
    latency_sites: JSON.parse(raw.latency_sites ?? '[]'),
  });
});

router.put('/', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const raw = getAllSettings();
  const errors = validateSettings(body, raw);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, errors });
  }
  const allowedNumbers = ['plan_download_mbps', 'plan_upload_mbps', 'test_interval_minutes', 'retention_days', 'alert_threshold_pct', 'alert_cooldown_minutes', 'public_status_refresh_seconds'];
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

  if (body.public_status_site_ids !== undefined && Array.isArray(body.public_status_site_ids)) {
    setSetting('public_status_site_ids', JSON.stringify(body.public_status_site_ids.map(Number).filter(Number.isFinite)));
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

  for (const key of ['notifications_enabled', 'notify_site_down', 'notify_site_slow', 'notify_speed_low', 'public_status_enabled', 'public_status_show_latency', 'public_status_show_speed', 'public_status_show_latency_summary', 'github_star_enabled']) {
    if (body[key] !== undefined) setSetting(key, body[key] ? 'true' : 'false');
  }

  if (body.notification_webhook_url !== undefined) {
    setSetting('notification_webhook_url', String(body.notification_webhook_url ?? '').trim());
  }

  for (const key of ['public_status_title', 'public_status_message']) {
    if (body[key] !== undefined) setSetting(key, String(body[key] ?? '').trim());
  }

  if (intervalChanged) restartScheduler();

  res.json({ success: true });
});

export default router;
