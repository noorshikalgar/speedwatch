import { useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { speedApi } from '@/api/client';
import type { Settings, SpeedResult } from '@/api/client';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { fmtSpeed, fmtMs, speedProviderLabel, speedStatus, unitLabel } from '@/lib/utils';
import { useUnit } from '@/contexts/unit';
import { cn } from '@/lib/utils';
import { formatActivityTime } from '@/lib/datetime';
import { SpeedDetailsDrawer } from './MonitorDetailsDrawer';

interface SpeedTableProps {
  settings: Settings | null;
  refreshKey?: number;
}

export function SpeedTable({ settings, refreshKey = 0 }: SpeedTableProps) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SpeedResult | null>(null);
  const pageSize = 15;
  const { unit } = useUnit();
  const ul = unitLabel(unit);

  const { data, isLoading } = useQuery({
    queryKey: ['speeds-page', page, refreshKey],
    queryFn: () => speedApi.page(page, pageSize),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const planDl = settings?.plan_download_mbps ?? 100;
  const threshold = settings?.alert_threshold_pct ?? 20;
  const timezone = settings?.display_timezone;
  const colClass = 'px-3 py-2.5 text-xs tabular-nums';

  return (
    <>
      <div className="border border-border bg-card animate-in fade-in-0 duration-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            History — {total} records
          </span>
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

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-right font-medium">Download ({ul})</th>
                <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Upload ({ul})</th>
                <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Ping (ms)</th>
                <th className="px-3 py-2 text-right font-medium hidden md:table-cell">Jitter (ms)</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Provider</th>
                <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Server</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">No records yet</td></tr>
              )}
              {rows.map((row, i) => {
                const dlSt = row.error ? 'low' : speedStatus(row.download_mbps, planDl, threshold);
                const isGood = dlSt === 'good' && !row.error;
                const isWarn = dlSt === 'warn' && !row.error;
                const isLow = dlSt === 'low' || !!row.error;

                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className={cn(
                      'cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors animate-in fade-in-0 slide-in-from-bottom-1',
                      { 'bg-destructive/10': isLow, 'bg-warning/10': isWarn }
                    )}
                    style={{ animationDelay: `${i * 25}ms`, animationDuration: '200ms' }}
                  >
                  <td className={cn(colClass, 'text-muted-foreground')}>
                    {formatActivityTime(row.timestamp, timezone)}
                    {row.is_manual === 1 && <span className="ml-1 text-primary/60 text-[10px]">manual</span>}
                  </td>
                  <td className={cn(colClass, 'text-right font-medium', isLow ? 'text-destructive' : isWarn ? 'text-warning' : 'text-metric-download')}>
                    {fmtSpeed(row.download_mbps, unit)}
                  </td>
                  <td className={cn(colClass, 'text-right text-metric-upload hidden sm:table-cell')}>{fmtSpeed(row.upload_mbps, unit)}</td>
                  <td className={cn(colClass, 'text-right text-metric-latency hidden sm:table-cell')}>{fmtMs(row.ping_ms)}</td>
                  <td className={cn(colClass, 'text-right text-metric-jitter hidden md:table-cell')}>{fmtMs(row.jitter_ms)}</td>
                  <td className={colClass}>
                    {row.error ? <Badge variant="destructive">error</Badge>
                      : isGood ? <Badge variant="success">good</Badge>
                      : isWarn ? <Badge variant="warning">warn</Badge>
                      : <Badge variant="destructive">low</Badge>}
                  </td>
                  <td className={cn(colClass, 'text-muted-foreground hidden md:table-cell')}>{speedProviderLabel(row.test_provider)}</td>
                  <td className={cn(colClass, 'text-muted-foreground hidden lg:table-cell')}>
                    <div className="flex items-center gap-1">
                        <span className="truncate">{row.server_name}</span>
                        {row.result_url && (
                          <a href={row.result_url} target="_blank" rel="noopener noreferrer" className="shrink-0" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink className="h-3 w-3 opacity-40 hover:opacity-100" />
                          </a>
                        )}
                    </div>
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <SpeedDetailsDrawer row={selected} unit={unit} timezone={timezone} onClose={() => setSelected(null)} />
    </>
  );
}
