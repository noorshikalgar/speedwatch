import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { sitesApi } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { formatActivityTime } from '@/lib/datetime';

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
      <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-10">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-xl font-semibold uppercase tracking-widest">SpeedWatch Status</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data?.updated_at ? `Updated ${formatActivityTime(data.updated_at, undefined, true)}` : 'Public status'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            {data && statusBadge(allOk ? 'ok' : 'degraded')}
          </div>
        </div>

        {isLoading && <div className="py-16 text-center text-sm text-muted-foreground">Loading status…</div>}
        {error && <div className="border border-border bg-card p-6 text-sm text-muted-foreground">Public status is not enabled.</div>}

        {data && (
          <div className="space-y-2">
            {data.sites.map(site => (
              <div key={site.id} className="grid gap-3 border border-border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{site.name}</span>
                    {statusBadge(site.status)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{site.status_reason ?? 'Healthy'}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-right text-xs tabular-nums">
                  <div><div className="text-muted-foreground">24h</div><div>{site.stats['24h'].uptime_pct ?? '—'}%</div></div>
                  <div><div className="text-muted-foreground">7d</div><div>{site.stats['7d'].uptime_pct ?? '—'}%</div></div>
                  <div><div className="text-muted-foreground">ms</div><div>{site.latency_ms != null ? Math.round(site.latency_ms) : '—'}</div></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
