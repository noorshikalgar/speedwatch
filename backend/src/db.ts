import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'speedwatch.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS speed_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    download_mbps REAL,
    upload_mbps REAL,
    ping_ms REAL,
    jitter_ms REAL,
    test_provider TEXT DEFAULT 'cloudflare',
    server_name TEXT DEFAULT 'Cloudflare',
    server_location TEXT DEFAULT '',
    server_id TEXT DEFAULT '',
    server_host TEXT DEFAULT '',
    isp_name TEXT DEFAULT '',
    client_ip TEXT DEFAULT '',
    result_url TEXT DEFAULT '',
    diagnostics TEXT DEFAULT '',
    is_manual INTEGER DEFAULT 0,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS latency_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    url TEXT NOT NULL,
    final_url TEXT DEFAULT '',
    latency_ms REAL,
    http_status INTEGER,
    status_text TEXT DEFAULT '',
    response_server TEXT DEFAULT '',
    content_type TEXT DEFAULT '',
    status TEXT NOT NULL,
    error_message TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS my_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    expected_status INTEGER DEFAULT 200,
    latency_threshold_ms INTEGER DEFAULT 500,
    interval_minutes INTEGER DEFAULT 15,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    url TEXT NOT NULL,
    final_url TEXT DEFAULT '',
    latency_ms REAL,
    http_status INTEGER,
    expected_status INTEGER DEFAULT 200,
    latency_threshold_ms INTEGER DEFAULT 500,
    status_text TEXT DEFAULT '',
    response_server TEXT DEFAULT '',
    content_type TEXT DEFAULT '',
    status TEXT NOT NULL,
    status_reason TEXT DEFAULT '',
    error_message TEXT DEFAULT '',
    FOREIGN KEY(site_id) REFERENCES my_sites(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_speed_ts ON speed_results(timestamp);
  CREATE INDEX IF NOT EXISTS idx_latency_ts ON latency_checks(timestamp);
  CREATE INDEX IF NOT EXISTS idx_site_checks_ts ON site_checks(timestamp);
  CREATE INDEX IF NOT EXISTS idx_site_checks_site_ts ON site_checks(site_id, timestamp);
`);

const speedColumns = db.prepare(`PRAGMA table_info(speed_results)`).all() as { name: string }[];
const speedColumnNames = new Set(speedColumns.map(c => c.name));
const missingSpeedColumns: [string, string][] = [
  ['test_provider', `ALTER TABLE speed_results ADD COLUMN test_provider TEXT DEFAULT 'cloudflare'`],
  ['server_id', `ALTER TABLE speed_results ADD COLUMN server_id TEXT DEFAULT ''`],
  ['server_host', `ALTER TABLE speed_results ADD COLUMN server_host TEXT DEFAULT ''`],
  ['isp_name', `ALTER TABLE speed_results ADD COLUMN isp_name TEXT DEFAULT ''`],
  ['client_ip', `ALTER TABLE speed_results ADD COLUMN client_ip TEXT DEFAULT ''`],
  ['diagnostics', `ALTER TABLE speed_results ADD COLUMN diagnostics TEXT DEFAULT ''`],
];
for (const [column, sql] of missingSpeedColumns) {
  if (!speedColumnNames.has(column)) db.exec(sql);
}

const latencyColumns = db.prepare(`PRAGMA table_info(latency_checks)`).all() as { name: string }[];
const latencyColumnNames = new Set(latencyColumns.map(c => c.name));
const missingLatencyColumns: [string, string][] = [
  ['final_url', `ALTER TABLE latency_checks ADD COLUMN final_url TEXT DEFAULT ''`],
  ['http_status', `ALTER TABLE latency_checks ADD COLUMN http_status INTEGER`],
  ['status_text', `ALTER TABLE latency_checks ADD COLUMN status_text TEXT DEFAULT ''`],
  ['response_server', `ALTER TABLE latency_checks ADD COLUMN response_server TEXT DEFAULT ''`],
  ['content_type', `ALTER TABLE latency_checks ADD COLUMN content_type TEXT DEFAULT ''`],
  ['error_message', `ALTER TABLE latency_checks ADD COLUMN error_message TEXT DEFAULT ''`],
];
for (const [column, sql] of missingLatencyColumns) {
  if (!latencyColumnNames.has(column)) db.exec(sql);
}

const siteCheckColumns = db.prepare(`PRAGMA table_info(site_checks)`).all() as { name: string }[];
const siteCheckColumnNames = new Set(siteCheckColumns.map(c => c.name));
const missingSiteCheckColumns: [string, string][] = [
  ['status_reason', `ALTER TABLE site_checks ADD COLUMN status_reason TEXT DEFAULT ''`],
];
for (const [column, sql] of missingSiteCheckColumns) {
  if (!siteCheckColumnNames.has(column)) db.exec(sql);
}

export type MySiteInput = {
  name: string;
  url: string;
  expected_status: number;
  latency_threshold_ms: number;
  interval_minutes: number;
  enabled: boolean;
};

const DEFAULTS: Record<string, string> = {
  plan_download_mbps: '100',
  plan_upload_mbps: '50',
  test_interval_minutes: '120',
  retention_days: '90',
  alert_threshold_pct: '20',
  display_timezone: 'Asia/Kolkata',
  speed_test_provider: 'cloudflare',
  speed_test_auto_round_robin: 'false',
  speed_test_round_robin_index: '0',
  librespeed_server_url: '',
  notifications_enabled: 'false',
  notification_webhook_url: '',
  notify_site_down: 'true',
  notify_site_slow: 'true',
  notify_speed_low: 'true',
  public_status_enabled: 'false',
  github_star_enabled: 'true',
  github_repo_url: 'https://github.com/noorshikalgar/speedwatch',
  latency_sites: JSON.stringify(['https://google.com', 'https://cloudflare.com', 'https://github.com']),
};

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULTS)) insertDefault.run(k, v);

export function getSetting(key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function insertSpeedResult(r: {
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
  jitter_ms: number | null;
  test_provider: string;
  server_name: string;
  server_location: string;
  server_id: string;
  server_host: string;
  isp_name: string;
  client_ip: string;
  result_url: string;
  diagnostics: string;
  is_manual: boolean;
  error?: string;
}) {
  return db.prepare(`
    INSERT INTO speed_results (timestamp, download_mbps, upload_mbps, ping_ms, jitter_ms, test_provider, server_name, server_location, server_id, server_host, isp_name, client_ip, result_url, diagnostics, is_manual, error)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    r.download_mbps,
    r.upload_mbps,
    r.ping_ms,
    r.jitter_ms,
    r.test_provider,
    r.server_name,
    r.server_location,
    r.server_id,
    r.server_host,
    r.isp_name,
    r.client_ip,
    r.result_url,
    r.diagnostics,
    r.is_manual ? 1 : 0,
    r.error ?? null,
  );
}

export function insertLatencyCheck(url: string, result: {
  latency_ms: number | null;
  status: string;
  final_url: string;
  http_status: number | null;
  status_text: string;
  response_server: string;
  content_type: string;
  error_message: string;
}) {
  db.prepare(`
    INSERT INTO latency_checks (timestamp, url, final_url, latency_ms, http_status, status_text, response_server, content_type, status, error_message)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    url,
    result.final_url,
    result.latency_ms,
    result.http_status,
    result.status_text,
    result.response_server,
    result.content_type,
    result.status,
    result.error_message,
  );
}

function normalizeSiteInput(input: Partial<MySiteInput>): MySiteInput {
  const url = String(input.url ?? '').trim();
  let parsedName = '';
  try { parsedName = new URL(url).hostname; } catch {}
  return {
    name: String(input.name ?? parsedName ?? url).trim() || url,
    url,
    expected_status: Math.min(599, Math.max(100, Number(input.expected_status ?? 200))),
    latency_threshold_ms: Math.max(1, Number(input.latency_threshold_ms ?? 500)),
    interval_minutes: Math.max(15, Number(input.interval_minutes ?? 15)),
    enabled: input.enabled ?? true,
  };
}

export function listMySites() {
  return db.prepare(`
    SELECT s.*,
      c.timestamp AS last_checked_at,
      c.latency_ms AS last_latency_ms,
      c.http_status AS last_http_status,
      c.status AS last_status
    FROM my_sites s
    LEFT JOIN site_checks c ON c.id = (
      SELECT id FROM site_checks WHERE site_id = s.id ORDER BY timestamp DESC LIMIT 1
    )
    ORDER BY s.created_at DESC
  `).all();
}

export function createMySite(input: Partial<MySiteInput>) {
  const site = normalizeSiteInput(input);
  return db.prepare(`
    INSERT INTO my_sites (name, url, expected_status, latency_threshold_ms, interval_minutes, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(site.name, site.url, site.expected_status, site.latency_threshold_ms, site.interval_minutes, site.enabled ? 1 : 0);
}

export function updateMySite(id: number, input: Partial<MySiteInput>) {
  const current = db.prepare('SELECT * FROM my_sites WHERE id = ?').get(id) as MySiteInput | undefined;
  if (!current) return { changes: 0 };
  const site = normalizeSiteInput({ ...current, ...input });
  return db.prepare(`
    UPDATE my_sites
    SET name = ?, url = ?, expected_status = ?, latency_threshold_ms = ?, interval_minutes = ?, enabled = ?
    WHERE id = ?
  `).run(site.name, site.url, site.expected_status, site.latency_threshold_ms, site.interval_minutes, site.enabled ? 1 : 0, id);
}

export function deleteMySite(id: number) {
  return db.prepare('DELETE FROM my_sites WHERE id = ?').run(id);
}

export function getMySite(id: number) {
  return db.prepare('SELECT * FROM my_sites WHERE id = ?').get(id) as any;
}

export function getLatestSiteCheck(siteId: number) {
  return db.prepare(`
    SELECT c.*, s.name AS site_name
    FROM site_checks c
    JOIN my_sites s ON s.id = c.site_id
    WHERE c.site_id = ?
    ORDER BY c.timestamp DESC
    LIMIT 1
  `).get(siteId) as any;
}

export function dueMySites(now = new Date()) {
  const rows = db.prepare(`
    SELECT s.*,
      (SELECT timestamp FROM site_checks WHERE site_id = s.id ORDER BY timestamp DESC LIMIT 1) AS last_checked_at
    FROM my_sites s
    WHERE s.enabled = 1
  `).all() as any[];
  return rows.filter(site => {
    if (!site.last_checked_at) return true;
    const last = new Date(String(site.last_checked_at).replace(' ', 'T') + 'Z').getTime();
    return now.getTime() - last >= Number(site.interval_minutes) * 60_000;
  });
}

export function insertSiteCheck(site: any, result: {
  latency_ms: number | null;
  status: string;
  final_url: string;
  http_status: number | null;
  status_text: string;
  response_server: string;
  content_type: string;
  error_message: string;
}) {
  const expectedStatus = Number(site.expected_status ?? 200);
  const threshold = Number(site.latency_threshold_ms ?? 500);
  const status = result.error_message
    ? result.status
    : result.http_status !== expectedStatus
      ? 'bad_status'
      : result.latency_ms != null && result.latency_ms > threshold
        ? 'slow'
        : 'ok';
  const statusReason = siteStatusReason({
    status,
    latency_ms: result.latency_ms,
    http_status: result.http_status,
    expected_status: expectedStatus,
    latency_threshold_ms: threshold,
    error_message: result.error_message,
  });

  return db.prepare(`
    INSERT INTO site_checks (site_id, timestamp, url, final_url, latency_ms, http_status, expected_status, latency_threshold_ms, status_text, response_server, content_type, status, status_reason, error_message)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    site.id,
    site.url,
    result.final_url,
    result.latency_ms,
    result.http_status,
    expectedStatus,
    threshold,
    result.status_text,
    result.response_server,
    result.content_type,
    status,
    statusReason,
    result.error_message,
  );
}

export function siteStatusReason(check: {
  status: string;
  latency_ms: number | null;
  http_status: number | null;
  expected_status: number;
  latency_threshold_ms: number;
  error_message?: string | null;
}) {
  if (check.status === 'ok') return 'Healthy';
  if (check.status === 'slow') {
    return `Latency ${Math.round(check.latency_ms ?? 0)} ms exceeded ${check.latency_threshold_ms} ms`;
  }
  if (check.status === 'bad_status') {
    return `Expected HTTP ${check.expected_status}, got ${check.http_status ?? 'none'}`;
  }
  if (check.status === 'timeout') return 'Request timed out';
  if (check.error_message) return check.error_message;
  return check.status.replace(/_/g, ' ');
}

export function getSiteChecks(sinceIso: string, limit = 1000) {
  return db.prepare(`
    SELECT *
    FROM (
      SELECT c.*, s.name AS site_name
      FROM site_checks c
      JOIN my_sites s ON s.id = c.site_id
      WHERE c.timestamp >= ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    )
    ORDER BY timestamp ASC
  `).all(sinceIso, limit);
}

export function getSiteChecksForSite(siteId: number, sinceIso: string, limit = 1000) {
  return db.prepare(`
    SELECT *
    FROM (
      SELECT c.*, s.name AS site_name
      FROM site_checks c
      JOIN my_sites s ON s.id = c.site_id
      WHERE c.site_id = ? AND c.timestamp >= ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    )
    ORDER BY timestamp ASC
  `).all(siteId, sinceIso, limit);
}

export function getAllSiteChecksSince(sinceIso: string, limit = 5000) {
  return db.prepare(`
    SELECT *
    FROM (
      SELECT c.*, s.name AS site_name
      FROM site_checks c
      JOIN my_sites s ON s.id = c.site_id
      WHERE c.timestamp >= ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    )
    ORDER BY timestamp ASC
  `).all(sinceIso, limit);
}

export function getSpeedResults(sinceIso: string, limit = 500) {
  return db.prepare(`
    SELECT * FROM speed_results WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT ?
  `).all(sinceIso, limit);
}

export function getLatestSpeed() {
  return db.prepare('SELECT * FROM speed_results ORDER BY timestamp DESC LIMIT 1').get();
}

export function getLatencyResults(sinceIso: string, limit = 500) {
  return db.prepare(`
    SELECT * FROM latency_checks WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT ?
  `).all(sinceIso, limit);
}

export function pruneOldData(retentionDays: number) {
  db.prepare(`DELETE FROM speed_results WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
  db.prepare(`DELETE FROM latency_checks WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
  db.prepare(`DELETE FROM site_checks WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
}

export function getSpeedPage(offset: number, pageSize: number) {
  const rows = db.prepare('SELECT * FROM speed_results ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(pageSize, offset);
  const total = (db.prepare('SELECT COUNT(*) as c FROM speed_results').get() as any).c;
  return { rows, total };
}

export default db;
