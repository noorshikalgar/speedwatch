import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import type { LatencyCheck } from '@/api/client';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { formatActivityTime, formatChartTick } from '@/lib/datetime';

interface LatencyChartProps {
  data: LatencyCheck[];
  range: '24h' | '7d' | '30d';
  onRangeChange: (r: '24h' | '7d' | '30d') => void;
  timezone?: string | null;
}

const PALETTE = [
  'hsl(var(--metric-latency))',
  'hsl(var(--primary))',
  'hsl(var(--info))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--metric-jitter))',
  'hsl(var(--metric-download))',
  'hsl(var(--metric-upload))',
];

function hostname(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function buildChartData(checks: LatencyCheck[]) {
  const urls = [...new Set(checks.map(c => c.url))];
  const hosts = urls.map(hostname);

  // Group by minute bucket
  const buckets = new Map<string, Record<string, number | null>>();
  for (const check of checks) {
    const ts = check.timestamp.substring(0, 16);
    if (!buckets.has(ts)) {
      buckets.set(ts, Object.fromEntries(hosts.map(h => [h, null])));
    }
    const h = hostname(check.url);
    buckets.get(ts)![h] = check.status === 'ok' ? check.latency_ms : null;
  }

  return {
    rows: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ts, vals]) => ({ timestamp: ts, ...vals })),
    hosts,
  };
}

function CustomTooltip({ active, payload, label, timezone }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="border border-border bg-card px-3 py-2 text-xs space-y-1">
      <p className="text-muted-foreground mb-1">{formatActivityTime(String(label), timezone)}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums" style={{ color: p.color }}>
            {p.value != null ? `${Number(p.value).toFixed(0)} ms` : 'error'}
          </span>
        </div>
      ))}
    </div>
  );
}

const RANGES = [
  { label: '24h', value: '24h' as const },
  { label: '7d', value: '7d' as const },
  { label: '30d', value: '30d' as const },
];

export function LatencyChart({ data, range, onRangeChange, timezone }: LatencyChartProps) {
  const { rows, hosts } = buildChartData(data);

  return (
    <div className="border border-border bg-card animate-in fade-in-0 duration-500">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Latency History
        </span>
        <Tabs value={range} onValueChange={(v) => onRangeChange(v as any)}>
          <TabsList>
            {RANGES.map((r) => (
              <TabsTrigger key={r.value} value={r.value}>{r.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="p-4 h-64">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No latency data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(v) => formatChartTick(v, range, timezone)}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false} minTickGap={40}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false} unit="ms"
              />
              <Tooltip content={<CustomTooltip timezone={timezone} />} />
              <Legend
                wrapperStyle={{ fontSize: 11, fontFamily: 'monospace', paddingTop: 8 }}
                formatter={(v) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{v}</span>}
              />
              {hosts.map((host, i) => (
                <Line
                  key={host}
                  type="monotone"
                  dataKey={host}
                  name={host}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive
                  animationDuration={800 + i * 150}
                  animationEasing="ease-out"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
