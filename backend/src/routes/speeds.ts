import { Router } from 'express';
import { getSpeedResults, getLatestSpeed, getSpeedPage } from '../db.js';
import { runAllTests, getSchedulerStatus } from '../scheduler.js';

const router = Router();

function rangeToIso(range: string): string {
  const now = new Date();
  const map: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
  const days = map[range] ?? 1;
  return new Date(now.getTime() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

router.get('/', (req, res) => {
  const range = (req.query.range as string) ?? '24h';
  const since = rangeToIso(range);
  const results = getSpeedResults(since);
  res.json(results);
});

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportName(parts: string[]) {
  return `${parts
    .map(part => part.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')}.csv`;
}

router.get('/export.csv', (req, res) => {
  const range = (req.query.range as string) ?? '30d';
  const rows = getSpeedResults(rangeToIso(range), 5000) as Record<string, unknown>[];
  const columns = ['timestamp', 'download_mbps', 'upload_mbps', 'ping_ms', 'jitter_ms', 'test_provider', 'server_name', 'server_location', 'isp_name', 'client_ip', 'result_url', 'is_manual', 'error'];
  const csv = [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvEscape(row[column])).join(',')),
  ].join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(exportName(['speedwatch', 'all-speed-tests', range]));
  res.send(csv);
});

router.get('/latest', (_req, res) => {
  res.json(getLatestSpeed() ?? null);
});

router.get('/page', (req, res) => {
  const page = parseInt((req.query.page as string) ?? '1', 10);
  const pageSize = parseInt((req.query.pageSize as string) ?? '15', 10);
  const offset = (page - 1) * pageSize;
  res.json(getSpeedPage(offset, pageSize));
});

router.get('/status', (_req, res) => {
  res.json(getSchedulerStatus());
});

router.post('/run', async (_req, res) => {
  try {
    await runAllTests();
    res.json({ success: true, latest: getLatestSpeed() });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
