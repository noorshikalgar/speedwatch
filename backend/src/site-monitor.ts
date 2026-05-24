import dns from 'dns/promises';
import tls from 'tls';
import { checkLatency, type LatencyResult } from './latency.js';

export type SiteMonitorResult = LatencyResult & {
  tls_valid: boolean | null;
  tls_expires_at: string;
  tls_days_left: number | null;
  tls_issuer: string;
  tls_error: string;
  dns_ms: number | null;
  dns_resolved: string;
  dns_matches: boolean | null;
  dns_error: string;
};

function emptyDiagnostics(): Omit<SiteMonitorResult, keyof LatencyResult> {
  return {
    tls_valid: null,
    tls_expires_at: '',
    tls_days_left: null,
    tls_issuer: '',
    tls_error: '',
    dns_ms: null,
    dns_resolved: '',
    dns_matches: null,
    dns_error: '',
  };
}

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeExpectedDns(value: string) {
  return value
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
}

async function checkTls(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    return { tls_valid: false, tls_expires_at: '', tls_days_left: null, tls_issuer: '', tls_error: 'TLS monitor requires HTTPS' };
  }

  return new Promise<Pick<SiteMonitorResult, 'tls_valid' | 'tls_expires_at' | 'tls_days_left' | 'tls_issuer' | 'tls_error'>>((resolve) => {
    const socket = tls.connect({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 443,
      servername: parsed.hostname,
      rejectUnauthorized: false,
      timeout: 8_000,
    });

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
      const tlsDaysLeft = validTo ? Math.ceil((validTo.getTime() - Date.now()) / 86_400_000) : null;
      const authorized = socket.authorized || !socket.authorizationError;

      resolve({
        tls_valid: Boolean(authorized && validTo && tlsDaysLeft != null && tlsDaysLeft >= 0),
        tls_expires_at: validTo && Number.isFinite(validTo.getTime()) ? validTo.toISOString() : '',
        tls_days_left: tlsDaysLeft,
        tls_issuer: String(cert.issuer?.O || cert.issuer?.CN || ''),
        tls_error: socket.authorizationError ? String(socket.authorizationError) : '',
      });
      socket.end();
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve({ tls_valid: false, tls_expires_at: '', tls_days_left: null, tls_issuer: '', tls_error: 'TLS check timed out' });
    });

    socket.once('error', (err) => {
      resolve({ tls_valid: false, tls_expires_at: '', tls_days_left: null, tls_issuer: '', tls_error: err.message });
    });
  });
}

async function checkDns(url: string, expectedDns: string) {
  const host = hostnameFromUrl(url);
  const start = performance.now();
  try {
    const [a, aaaa, cname] = await Promise.allSettled([
      dns.resolve4(host),
      dns.resolve6(host),
      dns.resolveCname(host),
    ]);
    const records = [
      ...(a.status === 'fulfilled' ? a.value : []),
      ...(aaaa.status === 'fulfilled' ? aaaa.value : []),
      ...(cname.status === 'fulfilled' ? cname.value : []),
    ];
    const dnsMs = Math.round((performance.now() - start) * 10) / 10;
    const resolved = Array.from(new Set(records)).sort();
    const expected = normalizeExpectedDns(expectedDns);
    const normalizedResolved = new Set(resolved.map(record => record.toLowerCase()));
    const matches = expected.length ? expected.some(record => normalizedResolved.has(record)) : null;

    return {
      dns_ms: dnsMs,
      dns_resolved: JSON.stringify(resolved),
      dns_matches: matches,
      dns_error: resolved.length ? '' : 'No DNS records resolved',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { dns_ms: Math.round((performance.now() - start) * 10) / 10, dns_resolved: '[]', dns_matches: false, dns_error: msg };
  }
}

export async function checkSiteMonitor(site: any): Promise<SiteMonitorResult> {
  const latency = await checkLatency(site.url);
  const diagnostics = emptyDiagnostics();

  const [tlsResult, dnsResult] = await Promise.all([
    site.check_tls === 1 ? checkTls(site.url).catch(err => ({ tls_valid: false, tls_expires_at: '', tls_days_left: null, tls_issuer: '', tls_error: err instanceof Error ? err.message : String(err) })) : null,
    site.check_dns === 1 ? checkDns(site.url, site.expected_dns ?? '').catch(err => ({ dns_ms: null, dns_resolved: '[]', dns_matches: false, dns_error: err instanceof Error ? err.message : String(err) })) : null,
  ]);

  return {
    ...latency,
    ...diagnostics,
    ...(tlsResult ?? {}),
    ...(dnsResult ?? {}),
  };
}
