import cron from 'node-cron';
import { normalizeSpeedTestProvider, runSpeedTest, type SpeedTestProvider } from './speedtest.js';
import { checkLatency } from './latency.js';
import { dueMySites, getLatestSiteCheck, getSetting, insertSiteCheck, setSetting, insertSpeedResult, insertLatencyCheck, pruneOldData } from './db.js';
import { sendNotification } from './notifications.js';

let currentTask: cron.ScheduledTask | null = null;
let siteMonitorTimer: NodeJS.Timeout | null = null;
let isRunning = false;
let isCheckingSites = false;
let lastRun: string | null = null;

function minutesToCron(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `0 */${hours} * * *`;
  return `0 */2 * * *`; // fallback
}

const ROUND_ROBIN_PROVIDERS: SpeedTestProvider[] = ['cloudflare', 'google', 'ookla'];

function nextScheduledRun(intervalMin: number, now = new Date()): string {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const nextSlotMinutes = (Math.floor(minutesSinceMidnight / intervalMin) + 1) * intervalMin;

  return new Date(dayStart.getTime() + nextSlotMinutes * 60_000).toISOString();
}

function nextProvider(): SpeedTestProvider {
  if (getSetting('speed_test_auto_round_robin') !== 'true') {
    return normalizeSpeedTestProvider(getSetting('speed_test_provider') ?? 'cloudflare');
  }

  const rawIndex = parseInt(getSetting('speed_test_round_robin_index') ?? '0', 10);
  const index = Number.isFinite(rawIndex) ? rawIndex : 0;
  const provider = ROUND_ROBIN_PROVIDERS[index % ROUND_ROBIN_PROVIDERS.length];
  setSetting('speed_test_round_robin_index', String((index + 1) % ROUND_ROBIN_PROVIDERS.length));
  return provider;
}

async function runAllTests() {
  if (isRunning) return;
  isRunning = true;
  lastRun = new Date().toISOString();
  console.log(`[scheduler] Running speed test at ${lastRun}`);

  try {
    const provider = nextProvider();
    const result = await runSpeedTest(provider, {
      librespeedServerUrl: getSetting('librespeed_server_url') ?? '',
    });
    insertSpeedResult({ ...result, is_manual: false });
    console.log(`[scheduler] Done — ${provider} — ${result.download_mbps ?? 'ERR'} Mbps down`);

    const planDownload = Number(getSetting('plan_download_mbps') ?? '100');
    const thresholdPct = Number(getSetting('alert_threshold_pct') ?? '20');
    const lowLimit = planDownload * ((100 - thresholdPct) / 100);
    if (!result.error && result.download_mbps != null && result.download_mbps < lowLimit) {
      await sendNotification(
        'speed_low',
        `SpeedWatch: download speed is low (${result.download_mbps.toFixed(1)} Mbps, plan ${planDownload} Mbps).`,
        { provider, download_mbps: result.download_mbps, plan_download_mbps: planDownload },
      );
    }

    const sitesRaw = getSetting('latency_sites') ?? '[]';
    const sites: string[] = JSON.parse(sitesRaw);
    for (const url of sites) {
      const result = await checkLatency(url);
      insertLatencyCheck(url, result);
    }

    const retention = parseInt(getSetting('retention_days') ?? '90', 10);
    pruneOldData(retention);
  } catch (err) {
    console.error('[scheduler] Error during test:', err);
  } finally {
    isRunning = false;
  }
}

async function runDueSiteChecks() {
  if (isCheckingSites) return;
  isCheckingSites = true;
  try {
    const sites = dueMySites();
    for (const site of sites) {
      const previous = getLatestSiteCheck(Number(site.id));
      const result = await checkLatency(site.url);
      insertSiteCheck(site, result);
      const latest = getLatestSiteCheck(Number(site.id));
      const previousHealthy = !previous || previous.status === 'ok';
      if (latest && latest.status !== 'ok' && previousHealthy) {
        await sendNotification(
          latest.status === 'slow' ? 'site_slow' : 'site_down',
          `SpeedWatch: ${site.name} is ${latest.status} — ${latest.status_reason || latest.error_message || 'check failed'}.`,
          { site_id: site.id, url: site.url, status: latest.status, reason: latest.status_reason },
        );
      }
    }
  } catch (err) {
    console.error('[sites] Error during site checks:', err);
  } finally {
    isCheckingSites = false;
  }
}

export function startScheduler() {
  stopScheduler();
  const intervalMin = parseInt(getSetting('test_interval_minutes') ?? '120', 10);
  const expression = minutesToCron(intervalMin);
  console.log(`[scheduler] Scheduling tests every ${intervalMin}m (cron: ${expression})`);

  currentTask = cron.schedule(expression, runAllTests);

  siteMonitorTimer = setInterval(runDueSiteChecks, 60_000);
  void runDueSiteChecks();
}

export function stopScheduler() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  if (siteMonitorTimer) {
    clearInterval(siteMonitorTimer);
    siteMonitorTimer = null;
  }
}

export function restartScheduler() {
  startScheduler();
}

export function getSchedulerStatus() {
  const intervalMin = parseInt(getSetting('test_interval_minutes') ?? '120', 10);
  return {
    isRunning,
    lastRun,
    nextRun: nextScheduledRun(intervalMin),
  };
}

export { runAllTests };
