import { Router } from 'express';
import { getAllSiteChecksSince, getLatestSpeed, listMySites, siteStatusReason } from '../db.js';
import { getSchedulerStatus } from '../scheduler.js';

const router = Router();

function rangeToIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

function unixSeconds(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ms = new Date(String(timestamp).replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labels(values: Record<string, unknown>): string {
  return `{${Object.entries(values).map(([key, value]) => `${key}="${esc(value)}"`).join(',')}}`;
}

function line(name: string, value: number | null | undefined, labelValues?: Record<string, unknown>): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return `${name}${labelValues ? labels(labelValues) : ''} ${value}`;
}

function help(name: string, text: string) {
  return [`# HELP ${name} ${text}`, `# TYPE ${name} gauge`];
}

function statsFor(checks: any[]) {
  const total = checks.length;
  const up = checks.filter(check => check.status === 'ok' || check.status === 'slow').length;
  const slow = checks.filter(check => check.status === 'slow').length;
  const failures = checks.filter(check => check.status !== 'ok' && check.status !== 'slow').length;
  const latencies = checks.map(check => check.latency_ms).filter((value): value is number => value != null);
  const avg = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null;
  const uptime = total ? (up / total) * 100 : null;
  const health = total ? Math.max(0, Math.round((up / total) * 100 - slow * 1.5 - failures * 4)) : null;
  return { total, up, slow, failures, avg, uptime, health };
}

router.get('/', (_req, res) => {
  const latestSpeed = getLatestSpeed() as any;
  const scheduler = getSchedulerStatus();
  const sites = listMySites() as any[];
  const checks30d = getAllSiteChecksSince(rangeToIso(30), 10_000) as any[];
  const now = Date.now();
  const windows = { '24h': 1, '7d': 7, '30d': 30 } as const;
  const bySite = new Map<number, any[]>();

  for (const check of checks30d) {
    const enriched = {
      ...check,
      status_reason: check.status_reason || siteStatusReason(check),
    };
    bySite.set(Number(check.site_id), [...(bySite.get(Number(check.site_id)) ?? []), enriched]);
  }

  const out: string[] = [
    ...help('speedwatch_up', 'SpeedWatch process scrape status.'),
    'speedwatch_up 1',
    ...help('speedwatch_scheduler_running', 'Whether a speed test is currently running.'),
    `speedwatch_scheduler_running ${scheduler.isRunning ? 1 : 0}`,
  ];

  const nextRun = unixSeconds(scheduler.nextRun);
  if (nextRun != null) out.push(...help('speedwatch_next_run_timestamp_seconds', 'Next scheduled speed test time.'), `speedwatch_next_run_timestamp_seconds ${nextRun}`);

  if (latestSpeed) {
    const speedLabels = { provider: latestSpeed.test_provider, server: latestSpeed.server_name };
    out.push(
      ...help('speedwatch_download_mbps', 'Latest measured download speed in Mbps.'),
      line('speedwatch_download_mbps', latestSpeed.download_mbps, speedLabels) ?? '',
      ...help('speedwatch_upload_mbps', 'Latest measured upload speed in Mbps.'),
      line('speedwatch_upload_mbps', latestSpeed.upload_mbps, speedLabels) ?? '',
      ...help('speedwatch_ping_ms', 'Latest speed test ping in milliseconds.'),
      line('speedwatch_ping_ms', latestSpeed.ping_ms, speedLabels) ?? '',
      ...help('speedwatch_jitter_ms', 'Latest speed test jitter in milliseconds.'),
      line('speedwatch_jitter_ms', latestSpeed.jitter_ms, speedLabels) ?? '',
    );
    const ts = unixSeconds(latestSpeed.timestamp);
    if (ts != null) out.push(...help('speedwatch_last_speed_test_timestamp_seconds', 'Last speed test timestamp.'), `speedwatch_last_speed_test_timestamp_seconds ${ts}`);
  }

  out.push(
    ...help('speedwatch_site_up', 'Whether the latest site check is healthy enough to be considered up.'),
    ...help('speedwatch_site_latency_ms', 'Latest site check latency in milliseconds.'),
    ...help('speedwatch_site_http_status', 'Latest site check HTTP status code.'),
    ...help('speedwatch_site_enabled', 'Whether the site monitor is enabled.'),
    ...help('speedwatch_site_uptime_percent', 'Site uptime percentage by window.'),
    ...help('speedwatch_site_health_score', 'Site health score from 0 to 100 by window.'),
    ...help('speedwatch_site_failures_total', 'Site failure count by window.'),
  );

  for (const site of sites) {
    const siteChecks = bySite.get(Number(site.id)) ?? [];
    const latest = siteChecks[siteChecks.length - 1];
    const base = { site_id: site.id, site: site.name, url: site.url };

    out.push(line('speedwatch_site_enabled', site.enabled === 1 ? 1 : 0, base)!);
    out.push(line('speedwatch_site_up', latest && (latest.status === 'ok' || latest.status === 'slow') ? 1 : 0, { ...base, status: latest?.status ?? 'unknown' })!);
    if (latest) {
      out.push(line('speedwatch_site_latency_ms', latest.latency_ms, base) ?? '');
      out.push(line('speedwatch_site_http_status', latest.http_status, base) ?? '');
      const ts = unixSeconds(latest.timestamp);
      if (ts != null) out.push(line('speedwatch_site_last_check_timestamp_seconds', ts, base)!);
    }

    for (const [windowName, days] of Object.entries(windows)) {
      const windowChecks = siteChecks.filter(check => now - (unixSeconds(check.timestamp) ?? 0) * 1000 <= days * 86_400_000);
      const stats = statsFor(windowChecks);
      const windowLabels = { ...base, window: windowName };
      out.push(line('speedwatch_site_uptime_percent', stats.uptime, windowLabels) ?? '');
      out.push(line('speedwatch_site_health_score', stats.health, windowLabels) ?? '');
      out.push(line('speedwatch_site_failures_total', stats.failures, windowLabels) ?? '');
      out.push(line('speedwatch_site_checks_total', stats.total, windowLabels) ?? '');
      out.push(line('speedwatch_site_avg_latency_ms', stats.avg, windowLabels) ?? '');
    }
  }

  res.type('text/plain; version=0.0.4; charset=utf-8');
  res.send(`${out.filter(Boolean).join('\n')}\n`);
});

export default router;
