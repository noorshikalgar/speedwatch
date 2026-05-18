import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { LatencyCheck, SiteCheck, SpeedResult } from '@/api/client';
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

  useEffect(() => {
    if (open) {
      setIsVisible(true);
      setIsClosing(false);
      return;
    }

    if (!isVisible) return;

    setIsClosing(true);
    const timeoutId = window.setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [open, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        className={`absolute inset-0 bg-background/60 transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
        aria-label="Close details"
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 flex h-dvh min-h-dvh w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200 ease-out ${isClosing ? 'translate-x-full' : 'translate-x-0'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold uppercase tracking-widest">{title}</h2>
            {subtitle && <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </aside>
    </div>
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
              <p className="break-words text-xs text-red-300">{row.error}</p>
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
              <p className="break-words text-xs text-red-300">{row.error_message}</p>
            </DetailSection>
          )}
        </>
      )}
    </Drawer>
  );
}

export function SiteCheckDetailsDrawer({
  row,
  timezone,
  onClose,
}: {
  row: SiteCheck | null;
  timezone?: string | null;
  onClose: () => void;
}) {
  const original = row ? parseUrl(row.url) : null;
  const final = row ? parseUrl(row.final_url || row.url) : null;

  return (
    <Drawer
      open={!!row}
      title="Site Check Details"
      subtitle={row ? row.site_name : undefined}
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
              { label: 'Expected Status', value: row.expected_status },
              { label: 'Latency Threshold', value: `${row.latency_threshold_ms} ms` },
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
              <p className="break-words text-xs text-red-300">{row.error_message}</p>
            </DetailSection>
          )}
        </>
      )}
    </Drawer>
  );
}
