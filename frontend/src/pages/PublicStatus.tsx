import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { sitesApi } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { formatActivityTime } from '@/lib/datetime';
import { cn } from '@/lib/utils';

function statusBadge(status?: string | null) {
  if (status === 'ok') return <Badge variant="success">operational</Badge>;
  if (status === 'slow' || status === 'timeout') return <Badge variant="warning">{status}</Badge>;
  if (!status || status === 'unknown') return <Badge variant="outline">unknown</Badge>;
  return <Badge variant="destructive">degraded</Badge>;
}

export function PublicStatusPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-status'],
    queryFn: sitesApi.publicStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  const allOk = data?.sites.every(site => site.status === 'ok') ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-4xl space-y-4 px-3 py-6 sm:px-4 sm:py-10">
        <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold uppercase tracking-widest sm:text-xl">{data?.title ?? 'SpeedWatch Status'}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data?.updated_at ? `Updated ${formatActivityTime(data.updated_at, undefined, true)}` : 'Public status'}
            </p>
            {data?.message && <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{data.message}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Activity className="status-ecg h-4 w-4 text-primary" />
            {data && statusBadge(allOk ? 'ok' : 'degraded')}
          </div>
        </div>

        {isLoading && <div className="py-16 text-center text-sm text-muted-foreground">Loading status…</div>}
        {error && <div className="border border-border bg-card p-6 text-sm text-muted-foreground">Public status is not enabled.</div>}

        {data && (
          <div className="space-y-2">
            {data.sites.map(site => (
              <div key={site.id} className="grid gap-4 border border-border bg-card p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{site.name}</span>
                    {statusBadge(site.status)}
                  </div>
                  <p className="mt-2 truncate text-xs text-muted-foreground">{site.status_reason ?? 'Healthy'}</p>
                  <p className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    Last checked {site.last_checked_at ? formatActivityTime(site.last_checked_at, undefined, true) : '—'}
                  </p>
                </div>
                <div className="grid gap-2 text-xs tabular-nums sm:grid-cols-3">
                  {[
                    ['24h uptime', site.stats['24h'].uptime_pct != null ? `${site.stats['24h'].uptime_pct}%` : '—'],
                    ['7d uptime', site.stats['7d'].uptime_pct != null ? `${site.stats['7d'].uptime_pct}%` : '—'],
                    ...(data.show_latency ? [['latency', site.latency_ms != null ? `${Math.round(site.latency_ms)} ms` : '—']] : []),
                  ].map(([label, value]) => (
                    <div key={label} className="min-h-[58px] border border-border bg-background px-3 py-2 text-left sm:text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                      <div className={cn('mt-2 text-base font-semibold', label === 'latency' && 'text-metric-latency')}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
