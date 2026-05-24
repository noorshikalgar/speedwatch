import { Router } from 'express';
import { checkLatency } from '../latency.js';
import {
  createMySite,
  deleteMySite,
  getAllSiteChecksSince,
  getMySite,
  getSetting,
  getSiteChecksForSite,
  getSiteChecks,
  insertSiteCheck,
  listMySites,
  updateMySite,
  siteStatusReason,
} from '../db.js';
import { sendNotification } from '../notifications.js';

const router = Router();

function rangeToIso(range: string): string {
  const now = new Date();
  const map: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30 };
  const days = map[range] ?? 1;
  return new Date(now.getTime() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  return [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvEscape(row[column])).join(',')),
  ].join('\n');
}

function exportName(parts: string[]) {
  return `${parts
    .map(part => part.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')}.csv`;
}

function checkTime(check: any) {
  return new Date(String(check.timestamp).replace(' ', 'T') + 'Z').getTime();
}

function statsFor(checks: any[]) {
  const total = checks.length;
  const up = checks.filter(check => check.status === 'ok' || check.status === 'slow').length;
  const slow = checks.filter(check => check.status === 'slow').length;
  const failures = checks.filter(check => check.status !== 'ok' && check.status !== 'slow').length;
  const latencyValues = checks.map(check => check.latency_ms).filter((value): value is number => value != null);
  const avgLatency = latencyValues.length
    ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
    : null;
  const availability = total ? Math.round((up / total) * 1000) / 10 : null;
  const healthScore = total
    ? Math.max(0, Math.round((up / total) * 100 - slow * 1.5 - failures * 4))
    : null;

  return { total, up, slow, failures, avg_latency_ms: avgLatency, uptime_pct: availability, health_score: healthScore };
}

function statsWindows(checks: any[], now = Date.now()) {
  const windows = { '24h': 1, '7d': 7, '30d': 30 } as const;
  return Object.fromEntries(Object.entries(windows).map(([key, days]) => [
    key,
    statsFor(checks.filter(check => now - checkTime(check) <= days * 86_400_000)),
  ]));
}

function buildIncidents(checks: any[]) {
  const incidents: any[] = [];
  let current: any | null = null;

  for (const check of checks) {
    const unhealthy = check.status !== 'ok';
    if (unhealthy && !current) {
      current = {
        status: check.status,
        started_at: check.timestamp,
        ended_at: null,
        recovered_at: null,
        active: true,
        reason: check.status_reason || siteStatusReason(check),
        checks: 1,
      };
      continue;
    }

    if (unhealthy && current) {
      current.checks += 1;
      if (check.status !== current.status && current.status === 'slow') current.status = check.status;
      current.reason = check.status_reason || current.reason;
      continue;
    }

    if (!unhealthy && current) {
      current.ended_at = check.timestamp;
      current.recovered_at = check.timestamp;
      current.active = false;
      const start = checkTime({ timestamp: current.started_at });
      const end = checkTime(check);
      current.duration_minutes = Math.max(1, Math.round((end - start) / 60_000));
      incidents.push(current);
      current = null;
    }
  }

  if (current) {
    current.duration_minutes = Math.max(1, Math.round((Date.now() - checkTime({ timestamp: current.started_at })) / 60_000));
    incidents.push(current);
  }

  return incidents.reverse().slice(0, 20);
}

function withStatusReasons(checks: any[]) {
  return checks.map(check => ({
    ...check,
    status_reason: check.status_reason || siteStatusReason(check),
  }));
}

function inMaintenance(site: any, now = new Date()) {
  try {
    const windows = JSON.parse(site.maintenance_windows || '[]') as Array<{ start: string; end: string }>;
    return windows.some(window => {
      const start = new Date(window.start).getTime();
      const end = new Date(window.end).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && now.getTime() >= start && now.getTime() <= end;
    });
  } catch {
    return false;
  }
}

async function runSiteCheck(site: any) {
  const previous = getSiteChecksForSite(Number(site.id), rangeToIso('30d'), 1).at(-1) as any;
  const result = await checkLatency(site.url);
  const insert = insertSiteCheck(site, result);
  const latest = (getSiteChecksForSite(Number(site.id), rangeToIso('30d'), 1).at(-1) as any) ?? null;
  const previousHealthy = !previous || previous.status === 'ok';
  const maintenance = inMaintenance(site);
  const shouldNotifySlow = latest?.status === 'slow' && site.notify_slow !== 0;
  const shouldNotifyDown = latest?.status !== 'slow' && latest?.status !== 'ok' && site.notify_down !== 0;

  if (latest && latest.status !== 'ok' && previousHealthy && !maintenance && (shouldNotifySlow || shouldNotifyDown)) {
    await sendNotification(
      latest.status === 'slow' ? 'site_slow' : 'site_down',
      `SpeedWatch: ${site.name} is ${latest.status} — ${latest.status_reason || latest.error_message || 'check failed'}.`,
      { site_id: site.id, url: site.url, status: latest.status, reason: latest.status_reason },
    );
  }

  return { id: Number(insert.lastInsertRowid), latest };
}

router.get('/', (_req, res) => {
  res.json(listMySites());
});

router.get('/summary', (_req, res) => {
  const sites = listMySites() as any[];
  const checks = withStatusReasons(getAllSiteChecksSince(rangeToIso('30d'), 5000) as any[]);
  const bySite = new Map<number, any[]>();
  for (const check of checks) bySite.set(Number(check.site_id), [...(bySite.get(Number(check.site_id)) ?? []), check]);

  res.json(sites.map(site => {
    const siteChecks = bySite.get(Number(site.id)) ?? [];
    const latest = siteChecks.at(-1) ?? null;
    const stats = statsWindows(siteChecks);
    return {
      ...site,
      latest,
      stats,
      health_score: stats['7d'].health_score,
      status_reason: latest?.status_reason ?? null,
      recent_incidents: buildIncidents(siteChecks).slice(0, 3),
    };
  }));
});

router.get('/public', (_req, res) => {
  if (getSetting('public_status_enabled') !== 'true') {
    return res.status(404).json({ success: false, error: 'public status is disabled' });
  }

  const sites = listMySites() as any[];
  const checks = withStatusReasons(getAllSiteChecksSince(rangeToIso('30d'), 5000) as any[]);
  const bySite = new Map<number, any[]>();
  for (const check of checks) bySite.set(Number(check.site_id), [...(bySite.get(Number(check.site_id)) ?? []), check]);

  res.json({
    title: getSetting('public_status_title') || 'SpeedWatch Status',
    message: getSetting('public_status_message') || '',
    show_latency: getSetting('public_status_show_latency') !== 'false',
    updated_at: new Date().toISOString(),
    sites: sites.filter(site => site.enabled === 1).map(site => {
      const siteChecks = bySite.get(Number(site.id)) ?? [];
      const latest = siteChecks.at(-1) ?? null;
      return {
        id: site.id,
        name: site.name,
        status: latest?.status ?? site.last_status ?? 'unknown',
        status_reason: latest?.status_reason ?? null,
        last_checked_at: latest?.timestamp ?? site.last_checked_at,
        latency_ms: latest?.latency_ms ?? site.last_latency_ms,
        stats: statsWindows(siteChecks),
      };
    }),
  });
});

router.get('/export.csv', (req, res) => {
  const range = (req.query.range as string) ?? '30d';
  const rows = withStatusReasons(getSiteChecks(rangeToIso(range), 5000) as any[]);
  const columns = ['timestamp', 'site_name', 'url', 'final_url', 'latency_ms', 'http_status', 'expected_status', 'latency_threshold_ms', 'status', 'status_reason', 'error_message'];
  res.header('Content-Type', 'text/csv');
  res.attachment(exportName(['speedwatch', 'all-sites', 'site-checks', range]));
  res.send(toCsv(rows, columns));
});

router.post('/run-all', async (_req, res) => {
  const sites = (listMySites() as any[]).filter(site => site.enabled === 1);
  const results = [];
  for (const site of sites) {
    results.push({ site_id: site.id, ...(await runSiteCheck(site)) });
  }
  res.json({ success: true, checked: results.length, results });
});

router.post('/', (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ success: false, error: 'url must start with http:// or https://' });
  }
  const result = createMySite(req.body ?? {});
  res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.body?.url !== undefined) {
    const url = String(req.body.url).trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ success: false, error: 'url must start with http:// or https://' });
    }
  }
  const result = updateMySite(id, req.body ?? {});
  res.json({ success: result.changes > 0 });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = deleteMySite(id);
  res.json({ success: result.changes > 0 });
});

router.post('/:id/check', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const site = getMySite(id);
  if (!site) return res.status(404).json({ success: false, error: 'site not found' });

  const result = await runSiteCheck(site);
  res.json({ success: true, id: result.id });
});

router.get('/checks', (req, res) => {
  const range = (req.query.range as string) ?? '24h';
  const rawLimit = parseInt(String(req.query.limit ?? '1000'), 10);
  const limit = Math.min(5000, Math.max(100, Number.isFinite(rawLimit) ? rawLimit : 1000));
  res.json(withStatusReasons(getSiteChecks(rangeToIso(range), limit) as any[]));
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const site = getMySite(id);
  if (!site) return res.status(404).json({ success: false, error: 'site not found' });
  const range = (req.query.range as string) ?? '30d';
  const checks = withStatusReasons(getSiteChecksForSite(id, rangeToIso(range), 5000) as any[]);
  res.json({
    site,
    checks,
    stats: statsWindows(checks),
    incidents: buildIncidents(checks),
  });
});

router.get('/:id/export.csv', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const site = getMySite(id);
  if (!site) return res.status(404).json({ success: false, error: 'site not found' });
  const range = (req.query.range as string) ?? '30d';
  const rows = withStatusReasons(getSiteChecksForSite(id, rangeToIso(range), 5000) as any[]);
  const columns = ['timestamp', 'site_name', 'url', 'final_url', 'latency_ms', 'http_status', 'expected_status', 'latency_threshold_ms', 'status', 'status_reason', 'error_message'];
  res.header('Content-Type', 'text/csv');
  res.attachment(exportName(['speedwatch', String(site.name), 'site-checks', range]));
  res.send(toCsv(rows, columns));
});

export default router;
