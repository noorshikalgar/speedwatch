import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Pencil, Play, Save, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { sitesApi, type MySitePayload, type SiteCheck } from '@/api/client';
import { cn } from '@/lib/utils';
import { formatActivityTime } from '@/lib/datetime';

type Range = '24h' | '7d' | '30d';
const CHECKS_PAGE_SIZE = 20;

function statusBadge(status?: string | null) {
  if (status === 'ok') return <Badge variant="success">ok</Badge>;
  if (status === 'slow' || status === 'timeout') return <Badge variant="warning">{status}</Badge>;
  if (!status) return <Badge variant="outline">none</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}

function statText(value: number | null | undefined, suffix = '') {
  return value == null ? '—' : `${value}${suffix}`;
}

function MiniLatencyChart({ checks, timezone }: { checks: SiteCheck[]; timezone?: string | null }) {
  const [hovered, setHovered] = useState<SiteCheck | null>(null);
  const points = checks.filter(check => check.latency_ms != null).slice(-80) as Array<SiteCheck & { latency_ms: number }>;
  if (points.length < 2) {
    return <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">Not enough latency data yet</div>;
  }

  const width = 900;
  const height = 260;
  const pad = 34;
  const max = Math.ceil(Math.max(...points.map(point => point.latency_ms), ...points.map(point => point.latency_threshold_ms), 100) / 100) * 100;
  const x = (index: number) => pad + (index / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const line = points.map((point, index) => `${x(index)},${y(point.latency_ms)}`).join(' ');
  const threshold = points.length > 0 ? points[points.length - 1].latency_threshold_ms : 500;

  return (
    <div className="relative" onMouseLeave={() => setHovered(null)}>
      {hovered && (
        <div className="absolute right-3 top-3 z-10 border border-border bg-card px-3 py-2 text-xs shadow-xl">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{formatActivityTime(hovered.timestamp, timezone, true)}</div>
          <div className="mt-1 font-semibold text-metric-latency tabular-nums">{hovered.latency_ms?.toFixed(1)} ms</div>
          <div className="mt-1 text-muted-foreground">HTTP {hovered.http_status ?? '—'} / {hovered.status}</div>
          <div className="mt-1 max-w-72 text-muted-foreground">{hovered.status_reason}</div>
          {hovered.final_url && <div className="mt-1 max-w-72 truncate text-muted-foreground">{hovered.final_url}</div>}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full">
        {[max, max / 2, 0].map(value => (
          <g key={value}>
            <path d={`M${pad} ${y(value)}H${width - pad}`} stroke="currentColor" className="text-border" />
            <text x={pad - 10} y={y(value) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{Math.round(value)}</text>
          </g>
        ))}
        <path d={`M${pad} ${y(threshold)}H${width - pad}`} stroke="currentColor" className="text-warning/50" strokeDasharray="6 6" />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="3" className="text-metric-latency" />
        {points.map((point, index) => (
          <circle
            key={point.id}
            cx={x(index)}
            cy={y(point.latency_ms)}
            r={hovered?.id === point.id ? 5 : 3.2}
            tabIndex={0}
            onMouseEnter={() => setHovered(point)}
            onFocus={() => setHovered(point)}
            className={point.status === 'ok' ? 'fill-success' : point.status === 'slow' ? 'fill-warning' : 'fill-destructive'}
          />
        ))}
      </svg>
    </div>
  );
}

export function SiteDetailsPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>('30d');
  const [checksPage, setChecksPage] = useState(1);
  const [isEditingConfig, setIsEditingConfig] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['site-detail', id, range],
    queryFn: () => sitesApi.detail(id, range),
    enabled: Number.isFinite(id),
  });

  const [draft, setDraft] = useState<Partial<MySitePayload> | null>(null);
  const form = draft ?? (data?.site ? {
    name: data.site.name,
    url: data.site.url,
    expected_status: data.site.expected_status,
    latency_threshold_ms: data.site.latency_threshold_ms,
    interval_minutes: data.site.interval_minutes,
    enabled: data.site.enabled === 1,
  } : null);

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<MySitePayload>) => sitesApi.update(id, payload),
    onSuccess: () => {
      setDraft(null);
      setIsEditingConfig(false);
      qc.invalidateQueries({ queryKey: ['site-detail', id] });
      qc.invalidateQueries({ queryKey: ['sites-summary'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: () => sitesApi.run(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-detail', id] });
      qc.invalidateQueries({ queryKey: ['sites-summary'] });
      qc.invalidateQueries({ queryKey: ['site-checks'] });
    },
  });

  const latest = data?.checks.length ? data.checks[data.checks.length - 1] : null;
  const checksDesc = useMemo(() => [...(data?.checks ?? [])].reverse(), [data?.checks]);
  const checksTotalPages = Math.max(1, Math.ceil(checksDesc.length / CHECKS_PAGE_SIZE));
  const shownChecks = checksDesc.slice((checksPage - 1) * CHECKS_PAGE_SIZE, checksPage * CHECKS_PAGE_SIZE);

  function startEdit() {
    if (!data?.site) return;
    setDraft({
      name: data.site.name,
      url: data.site.url,
      expected_status: data.site.expected_status,
      latency_threshold_ms: data.site.latency_threshold_ms,
      interval_minutes: data.site.interval_minutes,
      enabled: data.site.enabled === 1,
    });
    setIsEditingConfig(true);
  }

  function cancelEdit() {
    setDraft(null);
    setIsEditingConfig(false);
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/?tab=sites"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-widest">{data?.site.name ?? 'Site Details'}</h1>
              <p className="mt-1 text-xs text-muted-foreground">{data?.site.url}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(['24h', '7d', '30d'] as Range[]).map(option => (
              <Button key={option} variant={range === option ? 'secondary' : 'outline'} size="sm" onClick={() => { setRange(option); setChecksPage(1); }}>{option}</Button>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <a href={sitesApi.exportSiteUrl(id, range)}><Download className="h-3.5 w-3.5" /> CSV</a>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
              <Play className="h-3.5 w-3.5" /> Run
            </Button>
          </div>
        </div>

        {isLoading || !data || !form ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              <Card><CardContent className="p-4"><CardTitle>Health</CardTitle><div className="mt-2 text-2xl font-semibold">{statText(data.stats['7d'].health_score)}/100</div></CardContent></Card>
              <Card><CardContent className="p-4"><CardTitle>24h Uptime</CardTitle><div className="mt-2 text-2xl font-semibold">{statText(data.stats['24h'].uptime_pct, '%')}</div></CardContent></Card>
              <Card><CardContent className="p-4"><CardTitle>7d Uptime</CardTitle><div className="mt-2 text-2xl font-semibold">{statText(data.stats['7d'].uptime_pct, '%')}</div></CardContent></Card>
              <Card><CardContent className="p-4"><CardTitle>30d Uptime</CardTitle><div className="mt-2 text-2xl font-semibold">{statText(data.stats['30d'].uptime_pct, '%')}</div></CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Current Status</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex items-center gap-2">{statusBadge(latest?.status ?? data.site.last_status)}<span className="text-sm">{latest?.status_reason ?? 'No checks yet'}</span></div>
                  <p className="mt-2 text-xs text-muted-foreground">Last checked: {latest ? formatActivityTime(latest.timestamp, undefined, true) : '—'}</p>
                </div>
                <div className="text-right text-sm tabular-nums">
                  <div>Latency: <span className="text-metric-latency">{latest?.latency_ms != null ? `${latest.latency_ms.toFixed(1)} ms` : '—'}</span></div>
                  <div className="text-muted-foreground">HTTP {latest?.http_status ?? '—'}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Latency Chart</CardTitle></CardHeader>
              <CardContent><MiniLatencyChart checks={data.checks} /></CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Incidents</CardTitle>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Incidents group consecutive unhealthy checks into one event. A slow response, timeout, bad HTTP status, or error starts an incident; the next healthy check marks it recovered.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.incidents.length === 0 && <p className="text-sm text-muted-foreground">No incidents in this range.</p>}
                {data.incidents.map((incident, index) => (
                  <div key={`${incident.started_at}-${index}`} className="border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">{statusBadge(incident.status)}<span className="text-xs">{incident.reason}</span></div>
                      <span className="text-xs text-muted-foreground">{incident.active ? 'Active' : `Recovered in ${incident.duration_minutes}m`}</span>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Started {formatActivityTime(incident.started_at, undefined, true)}
                      {incident.recovered_at && <> · Recovered {formatActivityTime(incident.recovered_at, undefined, true)}</>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>All Checks</CardTitle>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setChecksPage(p => Math.max(1, p - 1))} disabled={checksPage === 1}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span>{checksPage} / {checksTotalPages}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setChecksPage(p => Math.min(checksTotalPages, p + 1))} disabled={checksPage >= checksTotalPages}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full">
                  <thead><tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-right">Latency</th><th className="px-3 py-2 text-left">HTTP</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Reason</th>
                  </tr></thead>
                  <tbody>
                    {shownChecks.map(check => (
                      <tr key={check.id} className="border-b border-border/50 text-xs">
                        <td className="px-3 py-2 text-muted-foreground">{formatActivityTime(check.timestamp, undefined, true)}</td>
                        <td className={cn('px-3 py-2 text-right tabular-nums', check.status === 'slow' ? 'text-warning' : 'text-metric-latency')}>{check.latency_ms != null ? `${check.latency_ms.toFixed(1)} ms` : '—'}</td>
                        <td className="px-3 py-2">{check.http_status ?? '—'}</td>
                        <td className="px-3 py-2">{statusBadge(check.status)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{check.status_reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Monitor Settings</CardTitle>
                  {!isEditingConfig ? (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={startEdit}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={cancelEdit}>
                      <X className="h-3.5 w-3.5" /> Cancel
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!isEditingConfig ? (
                  <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div className="border border-border bg-background p-3"><dt className="uppercase tracking-wider text-muted-foreground">Target</dt><dd className="mt-1 truncate text-foreground">{data.site.url}</dd></div>
                    <div className="border border-border bg-background p-3"><dt className="uppercase tracking-wider text-muted-foreground">Expected</dt><dd className="mt-1 text-foreground">HTTP {data.site.expected_status}</dd></div>
                    <div className="border border-border bg-background p-3"><dt className="uppercase tracking-wider text-muted-foreground">Slow Limit</dt><dd className="mt-1 text-foreground">{data.site.latency_threshold_ms} ms</dd></div>
                    <div className="border border-border bg-background p-3"><dt className="uppercase tracking-wider text-muted-foreground">Schedule</dt><dd className="mt-1 text-foreground">{data.site.interval_minutes} min · {data.site.enabled === 1 ? 'enabled' : 'paused'}</dd></div>
                  </dl>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5"><Label>Name</Label><Input value={form.name ?? ''} onChange={e => setDraft(f => ({ ...form, ...f, name: e.target.value }))} /></div>
                      <div className="space-y-1.5"><Label>URL</Label><Input value={form.url ?? ''} onChange={e => setDraft(f => ({ ...form, ...f, url: e.target.value }))} /></div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                      <div className="space-y-1.5"><Label>Expected HTTP</Label><Input type="number" value={form.expected_status ?? 200} onChange={e => setDraft(f => ({ ...form, ...f, expected_status: parseInt(e.target.value, 10) || 200 }))} /></div>
                      <div className="space-y-1.5"><Label>Slow Limit ms</Label><Input type="number" value={form.latency_threshold_ms ?? 500} onChange={e => setDraft(f => ({ ...form, ...f, latency_threshold_ms: parseInt(e.target.value, 10) || 500 }))} /></div>
                      <div className="space-y-1.5"><Label>Every min</Label><Input type="number" min={1} value={form.interval_minutes ?? 15} onChange={e => setDraft(f => ({ ...form, ...f, interval_minutes: parseInt(e.target.value, 10) || 15 }))} /></div>
                      <div className="flex items-center gap-2 pb-2"><Switch checked={!!form.enabled} onCheckedChange={enabled => setDraft(f => ({ ...form, ...f, enabled }))} /><Label>Enabled</Label></div>
                    </div>
                    <div className="flex justify-end">
                      <Button className="gap-2" onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending || !draft}>
                        <Save className="h-3.5 w-3.5" /> Save Settings
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
