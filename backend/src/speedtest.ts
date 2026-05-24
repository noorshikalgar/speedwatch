import { execFile } from 'child_process';
import dns from 'dns/promises';
import { promisify } from 'util';

export interface SpeedResult {
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
  jitter_ms: number | null;
  test_provider: SpeedTestProvider;
  server_name: string;
  server_location: string;
  server_id: string;
  server_host: string;
  isp_name: string;
  client_ip: string;
  result_url: string;
  diagnostics: string;
  error?: string;
}

export type SpeedTestProvider = 'cloudflare' | 'google' | 'ookla' | 'librespeed';

export const SPEED_TEST_PROVIDERS: Record<SpeedTestProvider, { label: string; serverName: string; serverLocation: string; resultUrl: string }> = {
  cloudflare: {
    label: 'Cloudflare',
    serverName: 'Cloudflare',
    serverLocation: 'Global CDN',
    resultUrl: 'https://speed.cloudflare.com',
  },
  google: {
    label: 'Google',
    serverName: 'Google CDN',
    serverLocation: 'Global edge',
    resultUrl: 'https://www.google.com',
  },
  ookla: {
    label: 'Ookla',
    serverName: 'Ookla Speedtest',
    serverLocation: 'Auto-selected',
    resultUrl: 'https://www.speedtest.net',
  },
  librespeed: {
    label: 'LibreSpeed',
    serverName: 'LibreSpeed',
    serverLocation: 'Configured server',
    resultUrl: 'https://librespeed.org',
  },
};

const PROVIDERS = Object.keys(SPEED_TEST_PROVIDERS) as SpeedTestProvider[];
const CF_BASE = 'https://speed.cloudflare.com';
const GOOGLE_BASE = 'https://www.google.com';
const GOOGLE_DOWNLOAD_URL = 'https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb';
const TIMEOUT_MS = 30_000;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 5_000;
const execFileAsync = promisify(execFile);
type ExecError = NodeJS.ErrnoException & { stdout?: string; stderr?: string };

function normalizeBaseUrl(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function normalizeSpeedTestProvider(value: unknown): SpeedTestProvider {
  const provider = String(value ?? '').trim().toLowerCase();
  return PROVIDERS.includes(provider as SpeedTestProvider) ? provider as SpeedTestProvider : 'cloudflare';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function measurePing(url: string): Promise<{ ping: number; jitter: number }> {
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    await fetch(url, { cache: 'no-store' });
    times.push(performance.now() - start);
  }
  times.shift(); // discard warmup
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const jitter = Math.sqrt(times.reduce((s, t) => s + (t - avg) ** 2, 0) / times.length);
  return { ping: Math.round(avg * 10) / 10, jitter: Math.round(jitter * 10) / 10 };
}

async function measureDownload(url: string): Promise<number> {
  // Run 3 chunks and compute aggregate Mbps
  const chunkBytes = 25_000_000; // 25 MB
  const runs = 3;
  let totalBytes = 0;
  let totalMs = 0;

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const res = await fetch(url.includes('{bytes}') ? url.replace('{bytes}', String(chunkBytes)) : url);
    const buf = await res.arrayBuffer();
    totalMs += performance.now() - start;
    totalBytes += buf.byteLength;
  }

  return (totalBytes * 8) / (totalMs / 1000) / 1_000_000;
}

async function measureUpload(url: string): Promise<number> {
  const sizes = [2_000_000, 8_000_000, 8_000_000];
  let totalBytes = 0;
  let totalMs = 0;

  for (const size of sizes) {
    const body = new Uint8Array(size); // zeros are fine for throughput testing
    const start = performance.now();
    await fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    totalMs += performance.now() - start;
    totalBytes += size;
  }

  return (totalBytes * 8) / (totalMs / 1000) / 1_000_000;
}

async function measureLibreSpeedUpload(url: string): Promise<number> {
  const sizes = [2_000_000, 8_000_000, 8_000_000];
  let totalBytes = 0;
  let totalMs = 0;

  for (const size of sizes) {
    const body = new Uint8Array(size);
    const start = performance.now();
    await fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    totalMs += performance.now() - start;
    totalBytes += size;
  }

  return (totalBytes * 8) / (totalMs / 1000) / 1_000_000;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseOoklaJson(stdout: string): any | null {
  for (const line of stdout.split('\n').reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type !== 'log') return parsed;
    } catch {
      // Keep scanning; Ookla can print non-JSON license text before JSON output.
    }
  }
  return null;
}

function ooklaErrorMessage(err: unknown): string {
  if (err instanceof Error && 'code' in err && (err as ExecError).code === 'ENOENT') {
    return 'Ookla speedtest CLI is not installed';
  }

  const execErr = err as ExecError;
  const output = `${execErr.stdout ?? ''}\n${execErr.stderr ?? ''}`;
  const messages = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('{'))
    .map(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed.type === 'log' && parsed.message ? String(parsed.message).replace(/^Error:\s*/, '') : '';
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  const unique = [...new Set(messages)];
  if (unique.length > 0) return `Ookla Speedtest network error: ${unique.join('; ')}`;

  return err instanceof Error ? err.message.split('\n')[0] : String(err);
}

async function fetchDiagnostic(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return `${url}: reachable (${res.status})`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${url}: ${msg}`;
  }
}

async function ooklaDiagnostics(): Promise<string> {
  const details: string[] = [];
  try {
    const [v4, v6] = await Promise.allSettled([
      dns.resolve4('speedtest.net'),
      dns.resolve6('speedtest.net'),
    ]);
    details.push(v4.status === 'fulfilled' && v4.value.length > 0 ? `DNS IPv4 ok (${v4.value[0]})` : 'DNS IPv4 failed');
    details.push(v6.status === 'fulfilled' && v6.value.length > 0 ? `DNS IPv6 ok (${v6.value[0]})` : 'DNS IPv6 unavailable or failed');
  } catch (err) {
    details.push(`DNS check failed (${err instanceof Error ? err.message : String(err)})`);
  }

  details.push(await fetchDiagnostic('https://www.speedtest.net/'));
  details.push(await fetchDiagnostic('https://install.speedtest.net/'));
  details.push('If IPv6 is present but unreachable inside Docker, Ookla may choose an IPv6 path that the container cannot route.');
  return details.join('\n');
}

async function getCloudflareTrace(): Promise<{ client_ip: string; server_location: string; isp_name: string }> {
  try {
    const res = await fetch(`${CF_BASE}/cdn-cgi/trace`, { cache: 'no-store' });
    const text = await res.text();
    const fields = Object.fromEntries(
      text.split('\n')
        .map(line => line.split('='))
        .filter(parts => parts.length === 2),
    );
    return {
      client_ip: fields.ip ?? '',
      server_location: fields.colo ? `Cloudflare colo ${fields.colo}` : SPEED_TEST_PROVIDERS.cloudflare.serverLocation,
      isp_name: '',
    };
  } catch {
    return { client_ip: '', server_location: SPEED_TEST_PROVIDERS.cloudflare.serverLocation, isp_name: '' };
  }
}

async function runHttpSpeedTest(provider: Extract<SpeedTestProvider, 'cloudflare' | 'google'>): Promise<SpeedResult> {
  const meta = SPEED_TEST_PROVIDERS[provider];
  const endpoints = provider === 'cloudflare'
    ? {
        ping: `${CF_BASE}/cdn-cgi/trace`,
        download: `${CF_BASE}/__down?bytes={bytes}`,
        upload: `${CF_BASE}/__up`,
      }
    : {
        ping: `${GOOGLE_BASE}/generate_204`,
        download: GOOGLE_DOWNLOAD_URL,
        upload: `${GOOGLE_BASE}/gen_204`,
      };

  try {
    const [pingResult, trace] = await Promise.all([
      withTimeout(measurePing(endpoints.ping), TIMEOUT_MS),
      provider === 'cloudflare'
        ? getCloudflareTrace()
        : Promise.resolve({ client_ip: '', server_location: meta.serverLocation, isp_name: '' }),
    ]);
    const { ping, jitter } = pingResult;
    const [download_mbps, upload_mbps] = await Promise.all([
      withTimeout(measureDownload(endpoints.download), TIMEOUT_MS * 3),
      withTimeout(measureUpload(endpoints.upload), TIMEOUT_MS * 2),
    ]);

    return {
      download_mbps: round2(download_mbps),
      upload_mbps: round2(upload_mbps),
      ping_ms: ping,
      jitter_ms: jitter,
      test_provider: provider,
      server_name: meta.serverName,
      server_location: trace.server_location,
      server_id: '',
      server_host: new URL(endpoints.ping).hostname,
      isp_name: trace.isp_name,
      client_ip: trace.client_ip,
      result_url: meta.resultUrl,
      diagnostics: '',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      download_mbps: null,
      upload_mbps: null,
      ping_ms: null,
      jitter_ms: null,
      test_provider: provider,
      server_name: meta.serverName,
      server_location: meta.serverLocation,
      server_id: '',
      server_host: new URL(endpoints.ping).hostname,
      isp_name: '',
      client_ip: '',
      result_url: meta.resultUrl,
      diagnostics: '',
      error: msg,
    };
  }
}

async function probeLibreSpeed(baseUrl: string) {
  const candidates = [
    {
      prefix: `${baseUrl}/backend`,
      ping: `${baseUrl}/backend/empty.php`,
      download: `${baseUrl}/backend/garbage.php?ckSize={bytes}`,
      upload: `${baseUrl}/backend/empty.php`,
      ip: `${baseUrl}/backend/getIP.php`,
    },
    {
      prefix: baseUrl,
      ping: `${baseUrl}/empty.php`,
      download: `${baseUrl}/garbage.php?ckSize={bytes}`,
      upload: `${baseUrl}/empty.php`,
      ip: `${baseUrl}/getIP.php`,
    },
  ];

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.ping, { cache: 'no-store' });
      if (res.ok) return candidate;
    } catch {
      // Try the next common LibreSpeed backend layout.
    }
  }

  return candidates[0];
}

async function runLibreSpeedTest(serverUrlValue?: unknown): Promise<SpeedResult> {
  const meta = SPEED_TEST_PROVIDERS.librespeed;
  const baseUrl = normalizeBaseUrl(serverUrlValue);

  if (!baseUrl) {
    return {
      download_mbps: null,
      upload_mbps: null,
      ping_ms: null,
      jitter_ms: null,
      test_provider: 'librespeed',
      server_name: meta.serverName,
      server_location: meta.serverLocation,
      server_id: '',
      server_host: '',
      isp_name: '',
      client_ip: '',
      result_url: meta.resultUrl,
      diagnostics: 'Set a LibreSpeed server URL in Settings. Example: https://speed.example.com',
      error: 'LibreSpeed server URL is not configured',
    };
  }

  try {
    const endpoints = await probeLibreSpeed(baseUrl);
    const [pingResult, ipResult] = await Promise.all([
      withTimeout(measurePing(endpoints.ping), TIMEOUT_MS),
      withTimeout(fetch(endpoints.ip, { cache: 'no-store' }).then(async res => res.ok ? res.text() : ''), TIMEOUT_MS).catch(() => ''),
    ]);
    const { ping, jitter } = pingResult;
    const [download_mbps, upload_mbps] = await Promise.all([
      withTimeout(measureDownload(endpoints.download), TIMEOUT_MS * 3),
      withTimeout(measureLibreSpeedUpload(endpoints.upload), TIMEOUT_MS * 2),
    ]);
    const parsed = new URL(baseUrl);

    return {
      download_mbps: round2(download_mbps),
      upload_mbps: round2(upload_mbps),
      ping_ms: ping,
      jitter_ms: jitter,
      test_provider: 'librespeed',
      server_name: `LibreSpeed / ${parsed.hostname}`,
      server_location: meta.serverLocation,
      server_id: '',
      server_host: parsed.hostname,
      isp_name: '',
      client_ip: ipResult.trim().slice(0, 120),
      result_url: baseUrl,
      diagnostics: `Using LibreSpeed backend at ${endpoints.prefix}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const parsed = new URL(baseUrl);
    return {
      download_mbps: null,
      upload_mbps: null,
      ping_ms: null,
      jitter_ms: null,
      test_provider: 'librespeed',
      server_name: `LibreSpeed / ${parsed.hostname}`,
      server_location: meta.serverLocation,
      server_id: '',
      server_host: parsed.hostname,
      isp_name: '',
      client_ip: '',
      result_url: baseUrl,
      diagnostics: [
        await fetchDiagnostic(`${baseUrl}/backend/empty.php`),
        await fetchDiagnostic(`${baseUrl}/empty.php`),
        'LibreSpeed usually exposes empty.php, garbage.php, and getIP.php either at /backend or the server root.',
      ].join('\n'),
      error: msg,
    };
  }
}

async function runOoklaSpeedTest(): Promise<SpeedResult> {
  const meta = SPEED_TEST_PROVIDERS.ookla;
  try {
    const { stdout } = await execFileAsync('speedtest', ['--format=json', '--accept-license', '--accept-gdpr'], {
      timeout: TIMEOUT_MS * 4,
      maxBuffer: 1024 * 1024,
    });
    const data = parseOoklaJson(stdout);
    if (!data) throw new Error('Ookla Speedtest did not return a result');
    const server = data.server ?? {};
    const result = data.result ?? {};
    const connection = data.isp ?? '';
    const iface = data.interface ?? {};

    return {
      download_mbps: data.download?.bandwidth != null ? round2((data.download.bandwidth * 8) / 1_000_000) : null,
      upload_mbps: data.upload?.bandwidth != null ? round2((data.upload.bandwidth * 8) / 1_000_000) : null,
      ping_ms: data.ping?.latency != null ? round2(data.ping.latency) : null,
      jitter_ms: data.ping?.jitter != null ? round2(data.ping.jitter) : null,
      test_provider: 'ookla',
      server_name: server.name ?? meta.serverName,
      server_location: [server.location, server.country].filter(Boolean).join(', ') || meta.serverLocation,
      server_id: server.id != null ? String(server.id) : '',
      server_host: server.host ?? server.ip ?? '',
      isp_name: connection,
      client_ip: iface.externalIp ?? iface.internalIp ?? '',
      result_url: result.url ?? meta.resultUrl,
      diagnostics: '',
    };
  } catch (err) {
    const msg = ooklaErrorMessage(err);
    const diagnostics = await ooklaDiagnostics();
    const fallback = await runHttpSpeedTest('cloudflare');

    if (!fallback.error) {
      return {
        ...fallback,
        diagnostics: [
          'Ookla Speedtest failed, so SpeedWatch automatically used Cloudflare for this run.',
          `Ookla error: ${msg}`,
          diagnostics,
        ].join('\n'),
      };
    }

    return {
      ...fallback,
      test_provider: 'ookla',
      server_name: meta.serverName,
      server_location: meta.serverLocation,
      server_id: '',
      server_host: '',
      isp_name: '',
      client_ip: '',
      result_url: meta.resultUrl,
      diagnostics: [
        diagnostics,
        `Cloudflare fallback also failed: ${fallback.error}`,
      ].join('\n'),
      error: msg,
    };
  }
}

export async function runSpeedTest(providerValue: unknown = 'cloudflare', options: { librespeedServerUrl?: string } = {}): Promise<SpeedResult> {
  const provider = normalizeSpeedTestProvider(providerValue);
  let lastResult: SpeedResult | null = null;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS + 1; attempt++) {
    const result = provider === 'ookla'
      ? await runOoklaSpeedTest()
      : provider === 'librespeed'
        ? await runLibreSpeedTest(options.librespeedServerUrl)
        : await runHttpSpeedTest(provider);
    if (!result.error) {
      return attempt === 1 ? result : { ...result, diagnostics: `Succeeded on attempt ${attempt} after retry.` };
    }

    lastResult = {
      ...result,
      diagnostics: [
        result.diagnostics,
        `Attempt ${attempt} of ${RETRY_ATTEMPTS + 1} failed: ${result.error}`,
      ].filter(Boolean).join('\n'),
    };

    if (attempt <= RETRY_ATTEMPTS) await wait(RETRY_DELAY_MS);
  }

  return {
    ...lastResult!,
    diagnostics: `${lastResult!.diagnostics}\nRetried ${RETRY_ATTEMPTS} time(s) with ${RETRY_DELAY_MS / 1000}s between attempts.`,
  };
}
