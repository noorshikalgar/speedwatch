import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import type { LatencyCheck } from '@/api/client';
import { formatActivityTime } from '@/lib/datetime';
import { LatencyDetailsDrawer } from './MonitorDetailsDrawer';

interface LatencyTableProps {
  data: LatencyCheck[];
  isLoading?: boolean;
  timezone?: string | null;
}

function hostname(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

const col = 'px-3 py-2.5 text-xs tabular-nums';
const PAGE_SIZE = 20;

export function LatencyTable({ data, isLoading, timezone }: LatencyTableProps) {
  const [selected, setSelected] = useState<LatencyCheck | null>(null);
  const [page, setPage] = useState(1);

  const sorted = data.slice().reverse();
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <div className="border border-border bg-card animate-in fade-in-0 duration-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Latency Records — {data.length} entries
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
                <th className="px-3 py-2 text-left font-medium">Host</th>
                <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Latency (ms)</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && shown.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">No latency records yet</td></tr>
              )}
              {shown.map((row, i) => {
                const isOk = row.status === 'ok';
                const isTimeout = row.status === 'timeout';

                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors animate-in fade-in-0 slide-in-from-bottom-1"
                    style={{ animationDelay: `${i * 20}ms`, animationDuration: '200ms' }}
                  >
                    <td className={cn(col, 'text-muted-foreground')}>{formatActivityTime(row.timestamp, timezone, true)}</td>
                    <td className={cn(col, 'text-foreground font-medium')}>{hostname(row.url)}</td>
                    <td className={cn(col, 'text-right hidden sm:table-cell', isOk ? 'text-metric-latency' : 'text-muted-foreground')}>
                      {row.latency_ms != null ? row.latency_ms.toFixed(0) : '—'}
                    </td>
                    <td className={col}>
                      {isOk ? <Badge variant="success">ok</Badge>
                        : isTimeout ? <Badge variant="warning">timeout</Badge>
                        : <Badge variant="destructive">{row.status}</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <LatencyDetailsDrawer row={selected} timezone={timezone} onClose={() => setSelected(null)} />
    </>
  );
}
