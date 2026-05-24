export interface SpeedResult {
  id: number;
  timestamp: string;
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
  is_manual: number;
  error: string | null;
}

export interface LatencyCheck {
  id: number;
  timestamp: string;
  url: string;
  final_url: string;
  latency_ms: number | null;
  http_status: number | null;
  status_text: string;
  response_server: string;
  content_type: string;
  status: string;
  error_message: string;
}

export interface Settings {
  plan_download_mbps: number;
  plan_upload_mbps: number;
  test_interval_minutes: number;
  retention_days: number;
  alert_threshold_pct: number;
  display_timezone: string;
  speed_test_provider: SpeedTestProvider;
  speed_test_auto_round_robin: boolean;
  librespeed_server_url: string;
  notifications_enabled: boolean;
  notification_webhook_url: string;
  notify_site_down: boolean;
  notify_site_slow: boolean;
  notify_speed_low: boolean;
  alert_cooldown_minutes: number;
  public_status_enabled: boolean;
  public_status_title: string;
  public_status_message: string;
  public_status_show_latency: boolean;
  github_star_enabled: boolean;
  github_repo_url: string;
  latency_sites: string[];
}

export type TimeRange = '24h' | '7d' | '30d' | '90d';
export type SpeedTestProvider = 'cloudflare' | 'google' | 'ookla' | 'librespeed';

export interface MySite {
  id: number;
  name: string;
  url: string;
  expected_status: number;
  latency_threshold_ms: number;
  interval_minutes: number;
  enabled: number;
  notify_down: number;
  notify_slow: number;
  maintenance_windows: string;
  check_tls: number;
  check_dns: number;
  expected_dns: string;
  created_at: string;
  last_checked_at: string | null;
  last_latency_ms: number | null;
  last_http_status: number | null;
  last_status: string | null;
}

export interface SiteCheck {
  id: number;
  site_id: number;
  site_name: string;
  timestamp: string;
  url: string;
  final_url: string;
  latency_ms: number | null;
  http_status: number | null;
  expected_status: number;
  latency_threshold_ms: number;
  status_text: string;
  response_server: string;
  content_type: string;
  status: string;
  status_reason: string;
  error_message: string;
}

export interface SiteStats {
  total: number;
  up: number;
  slow: number;
  failures: number;
  avg_latency_ms: number | null;
  uptime_pct: number | null;
  health_score: number | null;
}

export interface SiteIncident {
  status: string;
  started_at: string;
  ended_at: string | null;
  recovered_at: string | null;
  active: boolean;
  reason: string;
  checks: number;
  duration_minutes: number;
}

export interface SiteSummary extends MySite {
  latest: SiteCheck | null;
  stats: Record<'24h' | '7d' | '30d', SiteStats>;
  health_score: number | null;
  status_reason: string | null;
  recent_incidents: SiteIncident[];
}

export interface SiteDetail {
  site: MySite;
  checks: SiteCheck[];
  stats: Record<'24h' | '7d' | '30d', SiteStats>;
  incidents: SiteIncident[];
}

export interface PublicStatusSite {
  id: number;
  name: string;
  status: string;
  status_reason: string | null;
  last_checked_at: string | null;
  latency_ms: number | null;
  stats: Record<'24h' | '7d' | '30d', SiteStats>;
}

export type MySitePayload = {
  name: string;
  url: string;
  expected_status: number;
  latency_threshold_ms: number;
  interval_minutes: number;
  enabled: boolean;
  notify_down: boolean;
  notify_slow: boolean;
  maintenance_windows: string;
  check_tls: boolean;
  check_dns: boolean;
  expected_dns: string;
};

const API = '/api';

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const speedApi = {
  list: (range: TimeRange) => api<SpeedResult[]>(`/speeds?range=${range}`),
  latest: () => api<SpeedResult | null>('/speeds/latest'),
  page: (page: number, pageSize = 15) =>
    api<{ rows: SpeedResult[]; total: number }>(`/speeds/page?page=${page}&pageSize=${pageSize}`),
  run: () => api<{ success: boolean; latest: SpeedResult }>('/speeds/run', { method: 'POST' }),
  status: () => api<{ isRunning: boolean; lastRun: string | null; nextRun: string | null }>('/speeds/status'),
  exportUrl: (range: TimeRange = '30d') => `${API}/speeds/export.csv?range=${range}`,
};

export const settingsApi = {
  get: () => api<Settings>('/settings'),
  update: (data: Partial<Settings>) =>
    api<{ success: boolean }>('/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
};

export const backupApi = {
  exportUrl: () => `${API}/backup/config.json`,
  importConfig: (data: unknown) =>
    api<{ success: boolean; imported_sites: number }>('/backup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
};

export const latencyApi = {
  list: (range: '24h' | '7d' | '30d') => api<LatencyCheck[]>(`/latency?range=${range}`),
  run: () => api<{ success: boolean; checked: number; results: Array<Partial<LatencyCheck> & { url: string }> }>('/latency/run', { method: 'POST' }),
};

export const sitesApi = {
  list: () => api<MySite[]>('/sites'),
  summary: () => api<SiteSummary[]>('/sites/summary'),
  detail: (id: number, range: '24h' | '7d' | '30d' = '30d') => api<SiteDetail>(`/sites/${id}?range=${range}`),
  create: (data: Partial<MySitePayload>) =>
    api<{ success: boolean; id: number }>('/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  update: (id: number, data: Partial<MySitePayload>) =>
    api<{ success: boolean }>(`/sites/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  remove: (id: number) => api<{ success: boolean }>(`/sites/${id}`, { method: 'DELETE' }),
  run: (id: number) => api<{ success: boolean; id: number }>(`/sites/${id}/check`, { method: 'POST' }),
  runAll: () => api<{ success: boolean; checked: number }>('/sites/run-all', { method: 'POST' }),
  checks: (range: '24h' | '7d' | '30d', limit = 1000) => api<SiteCheck[]>(`/sites/checks?range=${range}&limit=${limit}`),
  exportUrl: (range: '24h' | '7d' | '30d' = '30d') => `${API}/sites/export.csv?range=${range}`,
  exportSiteUrl: (id: number, range: '24h' | '7d' | '30d' = '30d') => `${API}/sites/${id}/export.csv?range=${range}`,
  publicStatus: () => api<{ title: string; message: string; show_latency: boolean; updated_at: string; sites: PublicStatusSite[] }>('/sites/public'),
};
