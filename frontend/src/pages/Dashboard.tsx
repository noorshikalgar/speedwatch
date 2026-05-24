import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, ChevronLeft, ChevronRight, BarChart2, Zap, Activity, Globe } from 'lucide-react';
import {
  speedApi, settingsApi, latencyApi,
  type TimeRange, type SpeedResult, type LatencyCheck, type Settings,
} from '@/api/client';
import { Header } from '@/components/Header';
import { StatCards } from '@/components/StatCards';
import { AlertBanner } from '@/components/AlertBanner';
import { SpeedChart } from '@/components/SpeedChart';
import { SpeedTable } from '@/components/SpeedTable';
import { CombinedChart } from '@/components/CombinedChart';
import { LatencyChart } from '@/components/LatencyChart';
import { LatencyTable } from '@/components/LatencyTable';
import { MySitesPanel } from '@/components/MySitesPanel';
import { LatencyDetailsDrawer, SpeedDetailsDrawer } from '@/components/MonitorDetailsDrawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { fmtSpeed, fmtMs, speedProviderLabel, speedStatus, unitLabel } from '@/lib/utils';
import { useUnit } from '@/contexts/unit';
import { cn } from '@/lib/utils';
import { formatActivityTime, formatTimeOnly } from '@/lib/datetime';

type LatencyRange = '24h' | '7d' | '30d';
type ViewTab = 'combined' | 'speed' | 'latency' | 'sites';
const VIEW_TABS: ViewTab[] = ['combined', 'speed', 'latency', 'sites'];

function isViewTab(value: string | null): value is ViewTab {
  return !!value && VIEW_TABS.includes(value as ViewTab);
}

function initialView(searchTab: string | null): ViewTab {
  if (isViewTab(searchTab)) return searchTab;
  const stored = sessionStorage.getItem('sw_dashboard_tab');
  return isViewTab(stored) ? stored : 'combined';
}

function host(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function intervalLabel(minutes?: number) {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function providerSettingLabel(settings: Settings | null | undefined) {
  if (!settings) return '—';
  return settings.speed_test_auto_round_robin ? 'Round robin' : speedProviderLabel(settings.speed_test_provider);
}
// minute bucket for grouping test runs
function bucket(ts: string) { return ts.substring(0, 16); }

// ─── Unified timeline row types ───────────────────────────────────────────────
type SpeedEntry  = { kind: 'speed';   bkt: string; data: SpeedResult };
type LatencyEntry = { kind: 'latency'; bkt: string; data: LatencyCheck };
type Entry = SpeedEntry | LatencyEntry;

function buildTimeline(speedRows: SpeedResult[], latencyRows: LatencyCheck[]): Entry[] {
  const entries: Entry[] = [
    ...speedRows.map(r => ({ kind: 'speed'   as const, bkt: bucket(r.timestamp), data: r })),
    ...latencyRows.map(r => ({ kind: 'latency' as const, bkt: bucket(r.timestamp), data: r })),
  ];
  // sort descending by raw timestamp
  entries.sort((a, b) => b.data.timestamp.localeCompare(a.data.timestamp));
  return entries;
}

// ─── Unified table ────────────────────────────────────────────────────────────
const COMBINED_PAGE_SIZE = 20;

function CombinedTable({ speedRows, latencyRows, settings }: {
  speedRows: SpeedResult[];
  latencyRows: LatencyCheck[];
  settings: Settings | null;
}) {
  const [selected, setSelected] = useState<Entry | null>(null);
  const [page, setPage] = useState(1);
  const { unit } = useUnit();
  const ul = unitLabel(unit);
  const timezone = settings?.display_timezone;
  const planDl   = settings?.plan_download_mbps ?? 100;
  const threshold = settings?.alert_threshold_pct ?? 20;

  const allEntries = buildTimeline(speedRows, latencyRows);
  const totalPages = Math.max(1, Math.ceil(allEntries.length / COMBINED_PAGE_SIZE));
  const entries = allEntries.slice((page - 1) * COMBINED_PAGE_SIZE, page * COMBINED_PAGE_SIZE);

  // track bucket changes to draw a divider between test-run groups
  let lastBkt = '';

  return (
    <div className="border border-border bg-card animate-in fade-in-0 duration-700">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Recent Activity</span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span>{page} / {totalPages}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {allEntries.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">No records yet — run a speed test</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left  font-medium w-32">Time</th>
                <th className="px-3 py-2 text-left  font-medium w-16 hidden sm:table-cell">Type</th>
                <th className="px-3 py-2 text-left  font-medium w-36 hidden md:table-cell">Server</th>
                <th className="px-3 py-2 text-left  font-medium">DL ({ul}) / Host</th>
                <th className="px-3 py-2 text-right font-medium w-24 hidden sm:table-cell">UL ({ul})</th>
                <th className="px-3 py-2 text-right font-medium w-20">ms</th>
                <th className="px-3 py-2 text-left  font-medium w-20">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const isNewBatch = entry.bkt !== lastBkt;
                lastBkt = entry.bkt;

                if (entry.kind === 'speed') {
                  const row = entry.data;
                  const st   = row.error ? 'low' : speedStatus(row.download_mbps, planDl, threshold);
                  const isLow  = st === 'low'  || !!row.error;
                  const isWarn = st === 'warn' && !row.error;

                  return (
                    <tr
                      key={`s-${row.id}`}
                      onClick={() => setSelected(entry)}
                      className={cn(
                        'cursor-pointer hover:bg-muted/30 transition-colors animate-in fade-in-0 slide-in-from-bottom-1',
                        isNewBatch ? 'border-t-2 border-primary/25' : 'border-t border-border/40',
                        isLow  && 'bg-destructive/10',
                        isWarn && 'bg-warning/10',
                      )}
                      style={{ animationDelay: `${i * 20}ms`, animationDuration: '200ms' }}
                    >
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{formatActivityTime(row.timestamp, timezone)}</td>
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">spd</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                        <div className="max-w-[220px]">
                          <div className="truncate">{speedProviderLabel(row.test_provider)} / {row.server_name}</div>
                        </div>
                      </td>
                      <td className={cn('px-3 py-2.5 text-xs tabular-nums font-semibold',
                        isLow ? 'text-destructive' : isWarn ? 'text-warning' : 'text-metric-download')}>
                        {fmtSpeed(row.download_mbps, unit)}
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-right text-metric-upload hidden sm:table-cell">
                        {fmtSpeed(row.upload_mbps, unit)}
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-right text-metric-latency">
                        {fmtMs(row.ping_ms)}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.error          ? <Badge variant="destructive">error</Badge>
                          : st === 'good'   ? <Badge variant="success">good</Badge>
                          : st === 'warn'   ? <Badge variant="warning">warn</Badge>
                          :                   <Badge variant="destructive">low</Badge>}
                      </td>
                    </tr>
                  );
                }

                // ── latency row ──────────────────────────────────────────────
                const row  = entry.data;
                const isOk = row.status === 'ok';

                return (
                  <tr
                    key={`l-${row.id}`}
                    onClick={() => setSelected(entry)}
                    className={cn(
                      'cursor-pointer hover:bg-muted/30 transition-colors animate-in fade-in-0 slide-in-from-bottom-1',
                      isNewBatch ? 'border-t-2 border-primary/25' : 'border-t border-border/40',
                    )}
                    style={{ animationDelay: `${i * 20}ms`, animationDuration: '200ms' }}
                  >
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{formatActivityTime(row.timestamp, timezone)}</td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">lat</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">Latency</td>
                    <td className="px-3 py-2 text-xs font-medium text-foreground">{host(row.url)}</td>
                    <td className="px-3 py-2 text-xs text-right text-muted-foreground/40 hidden sm:table-cell">—</td>
                    <td className={cn('px-3 py-2 text-xs tabular-nums text-right',
                      isOk ? 'text-metric-latency' : 'text-muted-foreground/50')}>
                      {isOk && row.latency_ms != null ? fmtMs(row.latency_ms) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {isOk                          ? <Badge variant="success">ok</Badge>
                        : row.status === 'timeout'   ? <Badge variant="warning">timeout</Badge>
                        :                              <Badge variant="destructive">{row.status}</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <SpeedDetailsDrawer
        row={selected?.kind === 'speed' ? selected.data : null}
        unit={unit}
        timezone={timezone}
        onClose={() => setSelected(null)}
      />
      <LatencyDetailsDrawer
        row={selected?.kind === 'latency' ? selected.data : null}
        timezone={timezone}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setViewState] = useState<ViewTab>(() => initialView(searchParams.get('tab')));
  const [speedRange, setSpeedRange]   = useState<TimeRange>('24h');
  const [latencyRange, setLatencyRange] = useState<LatencyRange>('24h');
  const [refreshKey, setRefreshKey] = useState(0);
  const qc = useQueryClient();

  const { data: latest }   = useQuery({ queryKey: ['latest'],   queryFn: speedApi.latest,   refetchInterval: 30_000 });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const { data: chartData = [] } = useQuery({
    queryKey: ['speeds', speedRange, refreshKey],
    queryFn: () => speedApi.list(speedRange),
    refetchInterval: 60_000,
  });
  const { data: latencyData = [], isLoading: latencyLoading } = useQuery({
    queryKey: ['latency', latencyRange, refreshKey],
    queryFn: () => latencyApi.list(latencyRange),
    refetchInterval: 60_000,
  });
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: speedApi.status, refetchInterval: 2_000 });

  const runMutation = useMutation({
    mutationFn: speedApi.run,
    onSuccess: () => {
      setRefreshKey(k => k + 1);
      qc.invalidateQueries({ queryKey: ['latest'] });
      qc.invalidateQueries({ queryKey: ['speeds'] });
      qc.invalidateQueries({ queryKey: ['latency'] });
      qc.invalidateQueries({ queryKey: ['status'] });
    },
  });

  const isTestRunning = runMutation.isPending || status?.isRunning;

  function setView(nextView: ViewTab) {
    setViewState(nextView);
    sessionStorage.setItem('sw_dashboard_tab', nextView);
    const next = new URLSearchParams(searchParams);
    if (nextView === 'combined') next.delete('tab');
    else next.set('tab', nextView);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (isViewTab(tab) && tab !== view) {
      setViewState(tab);
      sessionStorage.setItem('sw_dashboard_tab', tab);
    }
  }, [searchParams, view]);

  // (countdown lives in Header now — no local countdown state needed)

  // update document title while testing
  useEffect(() => {
    document.title = isTestRunning ? 'Testing… — SpeedWatch' : 'SpeedWatch';
    return () => { document.title = 'SpeedWatch'; };
  }, [isTestRunning]);

  const RunButton = (
    <Button onClick={() => runMutation.mutate()} disabled={isTestRunning} size="sm" className="gap-2 shrink-0">
      {isTestRunning
        ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Testing…</>
        : <><Play          className="h-3.5 w-3.5" />             Run Test Now</>}
    </Button>
  );

  const MonitorControls = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center border border-info/35 bg-info/10 text-[11px] uppercase tracking-wider overflow-hidden">
          <span className="px-2 py-1 text-info/75">Every</span>
          <span className="px-2 py-1 text-info border-l border-info/35">{intervalLabel(settings?.test_interval_minutes)}</span>
        </div>
        <div className="flex items-center border border-primary/35 bg-primary/10 text-[11px] uppercase tracking-wider overflow-hidden">
          <span className="px-2 py-1 text-primary/75">Server</span>
          <span className="px-2 py-1 text-primary border-l border-primary/35">{providerSettingLabel(settings)}</span>
        </div>
        <div className="flex items-center border border-warning/35 bg-warning/10 text-[11px] uppercase tracking-wider overflow-hidden">
          <span className="px-2 py-1 text-warning/75">Alert</span>
          <span className="px-2 py-1 text-warning border-l border-warning/35">{settings ? `${100 - settings.alert_threshold_pct}% of plan` : '—'}</span>
        </div>
        {status?.nextRun && (
          <div className="flex items-center border border-success/35 bg-success/10 text-[11px] uppercase tracking-wider overflow-hidden tabular-nums">
            <span className="px-2 py-1 text-success/75">Next</span>
            <span className="px-2 py-1 text-success border-l border-success/35">
              {formatTimeOnly(status.nextRun, settings?.display_timezone)}
            </span>
          </div>
        )}
      </div>
      {RunButton}
    </div>
  );

  const NAV_TABS = [
    { value: 'combined', label: 'Combined', Icon: BarChart2 },
    { value: 'speed',    label: 'Speed',    Icon: Zap },
    { value: 'latency',  label: 'Latency',  Icon: Activity },
    { value: 'sites',    label: 'My Sites', Icon: Globe },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header isRunning={isTestRunning} nextRun={status?.nextRun} timezone={settings?.display_timezone} />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5 pb-20 sm:pb-5 space-y-4">
        <Tabs value={view} onValueChange={v => setView(v as ViewTab)}>
          {/* top tabs — hidden on mobile, replaced by bottom nav */}
          <TabsList className="hidden sm:flex h-8">
            <TabsTrigger value="combined">Combined</TabsTrigger>
            <TabsTrigger value="speed">Speed Test</TabsTrigger>
            <TabsTrigger value="latency">Latency</TabsTrigger>
            <TabsTrigger value="sites">My Sites</TabsTrigger>
          </TabsList>

          {/* ── Combined ── */}
          <TabsContent value="combined" className="space-y-4 mt-4">
            <AlertBanner latest={latest ?? null} settings={settings ?? null} />
            <StatCards   latest={latest ?? null} settings={settings ?? null} />
            {MonitorControls}
            <CombinedChart speedData={chartData} latencyData={latencyData} settings={settings ?? null} />
            <CombinedTable speedRows={chartData} latencyRows={latencyData} settings={settings ?? null} />
          </TabsContent>

          {/* ── Speed Test ── */}
          <TabsContent value="speed" className="space-y-4 mt-4">
            <AlertBanner latest={latest ?? null} settings={settings ?? null} />
            <StatCards   latest={latest ?? null} settings={settings ?? null} />
            {MonitorControls}
            <SpeedChart data={chartData} settings={settings ?? null} range={speedRange} onRangeChange={setSpeedRange} />
            <SpeedTable settings={settings ?? null} refreshKey={refreshKey} />
          </TabsContent>

          {/* ── Latency ── */}
          <TabsContent value="latency" className="space-y-4 mt-4">
            <LatencyChart data={latencyData} range={latencyRange} onRangeChange={setLatencyRange} timezone={settings?.display_timezone} />
            <LatencyTable data={latencyData} isLoading={latencyLoading} timezone={settings?.display_timezone} />
          </TabsContent>

          {/* ── My Sites ── */}
          <TabsContent value="sites" className="space-y-4 mt-4">
            <MySitesPanel timezone={settings?.display_timezone} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Mobile bottom nav — iOS style, only on small screens */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card flex">
        {NAV_TABS.map(({ value, label, Icon }) => (
          <button
            key={value}
            onClick={() => setView(value as ViewTab)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] uppercase tracking-wider transition-colors',
              view === value
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className={cn('h-5 w-5', view === value && 'text-primary')} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
