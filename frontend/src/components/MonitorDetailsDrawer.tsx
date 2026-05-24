import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LatencyCheck, MySite, SiteCheck, SpeedResult } from '@/api/client';
import { Button } from '@/components/ui/button';
import { fmtMs, fmtSpeed, speedProviderLabel, type SpeedUnit, unitLabel } from '@/lib/utils';
import { formatActivityTime } from '@/lib/datetime';

type DetailItem = {
  label: string;
  value: string | number | null | undefined;
  href?: string;
};

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

function valueText(value: DetailItem['value']) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function DetailGrid({ items }: { items: DetailItem[] }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-xs text-foreground">
            {item.href && item.value ? (
              <a href={item.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                {valueText(item.value)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : valueText(item.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Drawer({ open, title, subtitle, onClose, children }: DrawerProps) {
  const [isVisible, setIsVisible] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [cachedTitle, setCachedTitle] = useState(title);
  const [cachedSubtitle, setCachedSubtitle] = useState(subtitle);
  const [cachedChildren, setCachedChildren] = useState(children);

  useEffect(() => {
    if (open) {
      setCachedTitle(title);
      setCachedSubtitle(subtitle);
      setCachedChildren(children);
      setIsVisible(true);
      setIsClosing(false);
      return;
    }

    if (!isVisible) return;

    setIsClosing(true);
    const timeoutId = window.setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
    }, 320);

    return () => window.clearTimeout(timeoutId);
  }, [children, isVisible, open, subtitle, title]);

  if (!isVisible) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 h-screen min-h-screen">
      <button
        className={`fixed inset-0 h-screen min-h-screen bg-background/60 transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
        aria-label="Close details"
        onClick={onClose}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 flex h-screen min-h-screen w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ease-out will-change-transform supports-[height:100dvh]:h-dvh supports-[height:100dvh]:min-h-dvh ${isClosing ? 'translate-x-full' : 'translate-x-0'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold uppercase tracking-widest">{cachedTitle}</h2>
            {cachedSubtitle && <p className="mt-1 truncate text-xs text-muted-foreground">{cachedSubtitle}</p>}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {cachedChildren}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function parseUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return { protocol: '', host: url, port: '', path: '' };
  }
}

function percentile(values: number[], pct: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

function SiteStat({ label, value, tone = 'text-foreground' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-h-[58px] flex-col justify-between border border-border bg-background px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 truncate text-base font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

const MAX_TREND_POINTS = 48;

function sampleTrendPoints(points: Array<SiteCheck & { latency_ms: number }>, maxPoints = MAX_TREND_POINTS) {
  if (points.length <= maxPoints) return points;

  const sampled: Array<SiteCheck & { latency_ms: number }> = [];
  const bucketSize = points.length / maxPoints;

  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(points.length, Math.floor((i + 1) * bucketSize));
    const bucket = points.slice(start, Math.max(start + 1, end));
    const representative = bucket.reduce((selected, point) => {
      if (point.status !== 'ok' && selected.status === 'ok') return point;
      if (point.status === selected.status && point.latency_ms > selected.latency_ms) return point;
      return selected;
    }, bucket[0]);
    sampled.push(representative);
  }

  sampled[sampled.length - 1] = points[points.length - 1];
  return sampled;
}

function SiteLatencyTrend({
  checks,
  threshold,
  timezone,
}: {
  checks: SiteCheck[];
  threshold: number;
  timezone?: string | null;
}) {
  const [hovered, setHovered] = useState<{
    check: SiteCheck & { latency_ms: number };
    x: number;
    y: number;
  } | null>(null);
  const measuredPoints = checks.filter(check => check.latency_ms != null) as Array<SiteCheck & { latency_ms: number }>;
  const points = sampleTrendPoints(measuredPoints);

  if (points.length < 2) {
    return <p className="border border-border bg-background px-3 py-6 text-center text-xs text-muted-foreground">Not enough latency samples yet</p>;
  }

  const width = 520;
  const height = 150;
  const padTop = 16;
  const padRight = 18;
  const padBottom = 20;
  const padLeft = 54;
  const rawMax = Math.max(threshold, ...points.map(point => point.latency_ms), 1);
  const maxLatency = Math.ceil(rawMax / 100) * 100 || 100;
  const midLatency = maxLatency / 2;
  const x = (index: number) => padLeft + (index / Math.max(1, points.length - 1)) * (width - padLeft - padRight);
  const y = (latency: number) => height - padBottom - (latency / maxLatency) * (height - padTop - padBottom);
  const line = points.map((point, index) => `${x(index)},${y(point.latency_ms)}`).join(' ');
  const thresholdY = y(Math.min(threshold, maxLatency));

  return (
    <div className="border border-border bg-background p-3">
      <div className="relative" onMouseLeave={() => setHovered(null)}>
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 min-w-36 border border-border bg-card px-3 py-2 text-xs shadow-xl"
            style={{
              left: `${(hovered.x / width) * 100}%`,
              top: `${(hovered.y / height) * 100}%`,
              transform: hovered.x > width * 0.72 ? 'translate(-100%, -110%)' : 'translate(10px, -110%)',
            }}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {formatActivityTime(hovered.check.timestamp, timezone)}
            </div>
            <div className="mt-1 font-semibold text-metric-latency tabular-nums">{hovered.check.latency_ms.toFixed(1)} ms</div>
            <div className="mt-1 text-muted-foreground">
              HTTP {hovered.check.http_status ?? '—'} / {hovered.check.status}
            </div>
          </div>
        )}
        <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" role="img" aria-label="Site latency trend">
        {[maxLatency, midLatency, 0].map(value => (
          <g key={value}>
            <path
              d={`M${padLeft} ${y(value)}H${width - padRight}`}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <text
              x={padLeft - 10}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] font-medium"
            >
              {Math.round(value)}
            </text>
          </g>
        ))}
        <path d={`M${padLeft} ${thresholdY}H${width - padRight}`} stroke="currentColor" className="text-warning/50" strokeDasharray="5 6" />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-metric-latency" />
        {hovered && (
          <path
            d={`M${hovered.x} ${padTop}V${height - padBottom}`}
            stroke="currentColor"
            className="text-muted-foreground/40"
            strokeDasharray="3 5"
          />
        )}
        {points.map((point, index) => {
          const pointX = x(index);
          const pointY = y(point.latency_ms);
          const isHovered = hovered?.check.id === point.id;

          return (
            <circle
              key={point.id}
              cx={pointX}
              cy={pointY}
              r={isHovered ? 5 : 3.2}
              onMouseEnter={() => setHovered({ check: point, x: pointX, y: pointY })}
              onFocus={() => setHovered({ check: point, x: pointX, y: pointY })}
              tabIndex={0}
              className={point.status === 'ok' ? 'fill-success' : point.status === 'slow' ? 'fill-warning' : 'fill-destructive'}
            />
          );
        })}
        </svg>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid-cols-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-metric-latency" />
          Latency ms
        </span>
        <span className="inline-flex items-center gap-1.5 sm:justify-center">
          <span className="h-0 w-5 border-t border-dashed border-warning/70" />
          Slow limit {threshold} ms
        </span>
        <span className="sm:text-right">
          {measuredPoints.length > points.length ? `${points.length} sampled dots` : 'Each dot is one check'}
        </span>
      </div>
    </div>
  );
}

export function SpeedDetailsDrawer({
  row,
  unit,
  timezone,
  onClose,
}: {
  row: SpeedResult | null;
  unit: SpeedUnit;
  timezone?: string | null;
  onClose: () => void;
}) {
  const ul = unitLabel(unit);

  return (
    <Drawer
      open={!!row}
      title="Speed Test Details"
      subtitle={row ? `${speedProviderLabel(row.test_provider)} / ${row.server_name}` : undefined}
      onClose={onClose}
    >
      {row && (
        <>
          <DetailSection title="Result">
            <DetailGrid items={[
              { label: 'Time', value: formatActivityTime(row.timestamp, timezone, true) },
              { label: `Download (${ul})`, value: fmtSpeed(row.download_mbps, unit) },
              { label: `Upload (${ul})`, value: fmtSpeed(row.upload_mbps, unit) },
              { label: 'Ping', value: `${fmtMs(row.ping_ms)} ms` },
              { label: 'Jitter', value: `${fmtMs(row.jitter_ms)} ms` },
              { label: 'Status', value: row.error ? 'error' : 'ok' },
              { label: 'Manual Run', value: row.is_manual === 1 ? 'yes' : 'no' },
              { label: 'Result Link', value: row.result_url, href: row.result_url },
            ]} />
          </DetailSection>
          <DetailSection title="Server">
            <DetailGrid items={[
              { label: 'Provider', value: speedProviderLabel(row.test_provider) },
              { label: 'Server Name', value: row.server_name },
              { label: 'Server Location', value: row.server_location },
              { label: 'Server ID', value: row.server_id },
              { label: 'Server Host', value: row.server_host },
              { label: 'Client ISP', value: row.isp_name },
              { label: 'Client IP', value: row.client_ip },
            ]} />
          </DetailSection>
          {row.error && (
            <DetailSection title="Error">
              <p className="break-words text-xs text-destructive">{row.error}</p>
            </DetailSection>
          )}
          {row.diagnostics && (
            <DetailSection title="Network Diagnostics">
              <pre className="whitespace-pre-wrap break-words border border-border bg-background p-3 text-[11px] leading-relaxed text-muted-foreground">
                {row.diagnostics}
              </pre>
            </DetailSection>
          )}
        </>
      )}
    </Drawer>
  );
}

export function LatencyDetailsDrawer({
  row,
  timezone,
  onClose,
}: {
  row: LatencyCheck | null;
  timezone?: string | null;
  onClose: () => void;
}) {
  const original = row ? parseUrl(row.url) : null;
  const final = row ? parseUrl(row.final_url || row.url) : null;

  return (
    <Drawer
      open={!!row}
      title="Latency Check Details"
      subtitle={row ? original?.host : undefined}
      onClose={onClose}
    >
      {row && original && final && (
        <>
          <DetailSection title="Result">
            <DetailGrid items={[
              { label: 'Time', value: formatActivityTime(row.timestamp, timezone, true) },
              { label: 'Latency', value: row.latency_ms != null ? `${row.latency_ms.toFixed(1)} ms` : null },
              { label: 'Status', value: row.status },
              { label: 'HTTP Status', value: row.http_status },
              { label: 'HTTP Text', value: row.status_text },
              { label: 'Response Server', value: row.response_server },
              { label: 'Content Type', value: row.content_type },
            ]} />
          </DetailSection>
          <DetailSection title="Endpoint">
            <DetailGrid items={[
              { label: 'Configured URL', value: row.url, href: row.url },
              { label: 'Final URL', value: row.final_url || row.url, href: row.final_url || row.url },
              { label: 'Configured Host', value: original.host },
              { label: 'Final Host', value: final.host },
              { label: 'Protocol', value: final.protocol },
              { label: 'Port', value: final.port || (final.protocol === 'https' ? '443' : final.protocol === 'http' ? '80' : '') },
              { label: 'Path', value: final.path },
            ]} />
          </DetailSection>
          {row.error_message && (
            <DetailSection title="Error">
              <p className="break-words text-xs text-destructive">{row.error_message}</p>
            </DetailSection>
          )}
        </>
      )}
    </Drawer>
  );
}

export function SiteCheckDetailsDrawer({
  site,
  row,
  history = [],
  timezone,
  onClose,
}: {
  site: MySite | null;
  row: SiteCheck | null;
  history?: SiteCheck[];
  timezone?: string | null;
  onClose: () => void;
}) {
  const displaySite = site;
  const configuredUrl = row?.url ?? displaySite?.url ?? '';
  const finalUrl = row?.final_url || configuredUrl;
  const expectedStatus = row?.expected_status ?? displaySite?.expected_status ?? 200;
  const latencyThreshold = row?.latency_threshold_ms ?? displaySite?.latency_threshold_ms ?? 500;
  const original = configuredUrl ? parseUrl(configuredUrl) : null;
  const final = finalUrl ? parseUrl(finalUrl) : null;
  const siteId = displaySite?.id ?? row?.site_id;
  const siteHistory = siteId ? history.filter(check => check.site_id === siteId) : [];
  const latencyValues = siteHistory
    .map(check => check.latency_ms)
    .filter((latency): latency is number => latency != null);
  const upChecks = siteHistory.filter(check => check.status === 'ok' || check.status === 'slow').length;
  const slowChecks = siteHistory.filter(check => check.status === 'slow').length;
  const failedChecks = siteHistory.filter(check => check.status !== 'ok' && check.status !== 'slow').length;
  const availability = siteHistory.length > 0 ? `${Math.round((upChecks / siteHistory.length) * 1000) / 10}%` : '—';
  const avgLatency = latencyValues.length > 0
    ? `${Math.round(latencyValues.reduce((sum, latency) => sum + latency, 0) / latencyValues.length)} ms`
    : '—';
  const p95Latency = percentile(latencyValues, 95);

  return (
    <Drawer
      open={!!displaySite}
      title="Site Details"
      subtitle={displaySite?.name}
      onClose={onClose}
    >
      {displaySite && original && final && (
        <>
          <DetailSection title="Last 7 Days">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SiteStat label="Availability" value={availability} tone={failedChecks > 0 ? 'text-warning' : 'text-success'} />
              <SiteStat label="Avg Latency" value={avgLatency} />
              <SiteStat label="P95" value={p95Latency != null ? `${Math.round(p95Latency)} ms` : '—'} />
              <SiteStat label="Failures" value={String(failedChecks)} tone={failedChecks > 0 ? 'text-destructive' : 'text-muted-foreground'} />
            </div>
            <div className="mt-3">
              <SiteLatencyTrend checks={siteHistory} threshold={latencyThreshold} timezone={timezone} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SiteStat label="Checks" value={String(siteHistory.length)} />
              <SiteStat label="Slow" value={String(slowChecks)} tone={slowChecks > 0 ? 'text-warning' : 'text-muted-foreground'} />
              <SiteStat label="Expected" value={`HTTP ${expectedStatus}`} />
              <SiteStat label="Limit" value={`${latencyThreshold} ms`} />
            </div>
          </DetailSection>
          <DetailSection title="Configuration">
            <DetailGrid items={[
              { label: 'Name', value: displaySite.name },
              { label: 'Enabled', value: displaySite.enabled === 1 ? 'yes' : 'no' },
              { label: 'Check Interval', value: `${displaySite.interval_minutes} minutes` },
              { label: 'Expected Status', value: `HTTP ${displaySite.expected_status}` },
              { label: 'Latency Threshold', value: `${displaySite.latency_threshold_ms} ms` },
              { label: 'Created', value: formatActivityTime(displaySite.created_at, timezone, true) },
              { label: 'Last Checked', value: displaySite.last_checked_at ? formatActivityTime(displaySite.last_checked_at, timezone, true) : null },
              { label: 'Last Status', value: displaySite.last_status },
            ]} />
          </DetailSection>
          <DetailSection title="Result">
            {row ? (
              <DetailGrid items={[
                { label: 'Time', value: formatActivityTime(row.timestamp, timezone, true) },
                { label: 'Latency', value: row.latency_ms != null ? `${row.latency_ms.toFixed(1)} ms` : null },
                { label: 'Status', value: row.status },
                { label: 'HTTP Status', value: row.http_status },
                { label: 'Expected Status', value: row.expected_status },
                { label: 'Latency Threshold', value: `${row.latency_threshold_ms} ms` },
                { label: 'HTTP Text', value: row.status_text },
                { label: 'Response Server', value: row.response_server },
                { label: 'Content Type', value: row.content_type },
                { label: 'Reason', value: row.status_reason },
              ]} />
            ) : (
              <p className="border border-border bg-background px-3 py-6 text-center text-xs text-muted-foreground">
                No checks yet. Run a check to capture the first result.
              </p>
            )}
          </DetailSection>
          <DetailSection title="Endpoint">
            <DetailGrid items={[
              { label: 'Configured URL', value: configuredUrl, href: configuredUrl },
              { label: 'Final URL', value: finalUrl, href: finalUrl },
              { label: 'Configured Host', value: original.host },
              { label: 'Final Host', value: final.host },
              { label: 'Protocol', value: final.protocol },
              { label: 'Port', value: final.port || (final.protocol === 'https' ? '443' : final.protocol === 'http' ? '80' : '') },
              { label: 'Path', value: final.path },
            ]} />
          </DetailSection>
          {row?.error_message && (
            <DetailSection title="Error">
              <p className="break-words text-xs text-destructive">{row.error_message}</p>
            </DetailSection>
          )}
        </>
      )}
    </Drawer>
  );
}
