import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Activity, ChevronUp, Download, ExternalLink, Play, Plus, Radio, Trash2 } from 'lucide-react';
import { sitesApi, type MySitePayload, type SiteSummary } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

function host(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function statusTone(status?: string | null) {
  if (status === 'ok') return 'bg-success';
  if (status === 'slow') return 'bg-warning';
  if (status === 'timeout') return 'bg-warning';
  if (!status) return 'bg-muted';
  return 'bg-destructive';
}

function statusBadge(status?: string | null) {
  if (status === 'ok') return <Badge variant="success">ok</Badge>;
  if (status === 'slow') return <Badge variant="warning">slow</Badge>;
  if (status === 'timeout') return <Badge variant="warning">timeout</Badge>;
  if (status === 'disabled') return <Badge variant="outline" className="text-muted-foreground">off</Badge>;
  return <Badge variant="destructive">{status ?? 'none'}</Badge>;
}

function latencyTone(latency: number | null, threshold: number) {
  if (latency == null) return 'text-muted-foreground';
  if (latency > threshold) return 'text-warning';
  return 'text-metric-latency';
}

function AddSiteForm({ onAdd, isPending }: {
  onAdd: (form: MySitePayload) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    name: '',
    url: '',
    expected_status: 200,
    latency_threshold_ms: 500,
    interval_minutes: 15,
    enabled: true,
    notify_down: true,
    notify_slow: true,
    maintenance_windows: '[]',
    check_tls: false,
    check_dns: false,
    expected_dns: '',
  });

  function submit() {
    if (!form.url.startsWith('http')) return;
    onAdd({ ...form, interval_minutes: Math.max(15, form.interval_minutes) });
    setForm({
      name: '',
      url: '',
      expected_status: 200,
      latency_threshold_ms: 500,
      interval_minutes: 15,
      enabled: true,
      notify_down: true,
      notify_slow: true,
      maintenance_windows: '[]',
      check_tls: false,
      check_dns: false,
      expected_dns: '',
    });
  }

  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[1fr_2fr_120px_140px_120px_auto] lg:items-end">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="API" />
      </div>
      <div className="space-y-1.5">
        <Label>URL</Label>
        <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://example.com/health" />
      </div>
      <div className="space-y-1.5">
        <Label>Status</Label>
        <Input type="number" min={100} max={599} value={form.expected_status} onChange={e => setForm(f => ({ ...f, expected_status: parseInt(e.target.value, 10) || 200 }))} />
      </div>
      <div className="space-y-1.5">
        <Label>Max ms</Label>
        <Input type="number" min={1} value={form.latency_threshold_ms} onChange={e => setForm(f => ({ ...f, latency_threshold_ms: parseInt(e.target.value, 10) || 500 }))} />
      </div>
      <div className="space-y-1.5">
        <Label>Every min</Label>
        <Input type="number" min={15} value={form.interval_minutes} onChange={e => setForm(f => ({ ...f, interval_minutes: parseInt(e.target.value, 10) || 15 }))} />
      </div>
      <Button onClick={submit} disabled={isPending} size="sm" className="gap-2">
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}

export function MySitesPanel({ timezone }: { timezone?: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);

  const { data: sites = [] } = useQuery({ queryKey: ['sites-summary'], queryFn: sitesApi.summary, refetchInterval: 60_000 });
  const isLoading = false;

  const createMutation = useMutation({
    mutationFn: sitesApi.create,
    onSuccess: () => {
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['sites-summary'] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MySitePayload> }) => sitesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites-summary'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: sitesApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites-summary'] });
    },
  });
  const runMutation = useMutation({
    mutationFn: sitesApi.run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites-summary'] });
    },
  });
  const runAllMutation = useMutation({
    mutationFn: sitesApi.runAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites-summary'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="border border-border bg-card">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Sites</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => runAllMutation.mutate()} disabled={runAllMutation.isPending}>
              <Radio className="h-3.5 w-3.5" /> Run All
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
              <a href={sitesApi.exportUrl('30d')}>
                <Download className="h-3.5 w-3.5" /> CSV
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowForm(v => !v)}
            >
              {showForm ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showForm ? 'Cancel' : 'New Site'}
            </Button>
          </div>
        </div>

        {showForm && (
          <div className="border-b border-border bg-muted/20">
            <AddSiteForm onAdd={(form) => createMutation.mutate(form)} isPending={createMutation.isPending} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Site</th>
                <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Uptime</th>
                <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Health</th>
                <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Last</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">No sites yet — click New Site to add one</td></tr>
              )}
              {(sites as SiteSummary[]).map(site => {
                const latestCheck = site.latest;
                const currentStatus = latestCheck?.status ?? site.last_status;
                const currentLatency = latestCheck?.latency_ms ?? site.last_latency_ms;
                const currentHttp = latestCheck?.http_status ?? site.last_http_status;
                return (
                  <tr
                    key={site.id}
                    onClick={() => navigate(`/sites/${site.id}`, { state: { from: '/?tab=sites' } })}
                    className="cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-3 py-3 text-xs font-medium">
                      <div className="flex items-start gap-2">
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', site.enabled === 1 ? statusTone(currentStatus) : 'bg-muted')} />
                        <div className="min-w-0">
                          <div className="truncate text-foreground">{site.name}</div>
                          <a
                            href={site.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="mt-0.5 inline-flex max-w-[160px] items-center gap-1 truncate text-[10px] text-muted-foreground hover:text-primary"
                          >
                            <span className="truncate">{host(site.url)}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <div className="flex items-baseline gap-4 text-xs tabular-nums">
                        <span><span className="text-muted-foreground">24h</span> {site.stats['24h'].uptime_pct ?? '—'}%</span>
                        <span><span className="text-muted-foreground">7d</span> {site.stats['7d'].uptime_pct ?? '—'}%</span>
                        <span><span className="text-muted-foreground">30d</span> {site.stats['30d'].uptime_pct ?? '—'}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden bg-muted">
                          <div
                            className={cn('h-full', (site.health_score ?? 0) >= 95 ? 'bg-success' : (site.health_score ?? 0) >= 80 ? 'bg-warning' : 'bg-destructive')}
                            style={{ width: `${Math.max(0, Math.min(100, site.health_score ?? 0))}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums">{site.health_score ?? '—'}/100</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right hidden sm:table-cell">
                      <div className={cn('text-sm font-semibold tabular-nums', latencyTone(currentLatency, site.latency_threshold_ms))}>
                        {currentLatency != null ? currentLatency.toFixed(0) : '—'}
                        {currentLatency != null && <span className="ml-1 text-[10px] font-normal text-muted-foreground">ms</span>}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        HTTP {currentHttp ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        {statusBadge(site.enabled === 1 ? currentStatus : 'disabled')}
                        {site.status_reason && <div className="max-w-40 truncate text-[10px] text-muted-foreground" title={site.status_reason}>{site.status_reason}</div>}
                        {site.enabled !== 1 && <div className="text-[10px] uppercase tracking-wider text-muted-foreground">paused</div>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center border border-border bg-background px-2 py-1">
                          <Switch
                            checked={site.enabled === 1}
                            onCheckedChange={enabled => updateMutation.mutate({ id: site.id, data: { enabled } })}
                          />
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Run check now" onClick={() => runMutation.mutate(site.id)}>
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Delete site" onClick={() => deleteMutation.mutate(site.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {isLoading && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-muted-foreground">
                  <Activity className="mr-1 inline h-3.5 w-3.5 animate-pulse" /> Loading checks…
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
