import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import type { SpeedResult, Settings, TimeRange } from '@/api/client';
import { toDisplaySpeed, unitLabel } from '@/lib/utils';
import { useUnit } from '@/contexts/unit';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { formatActivityTime, formatChartTick } from '@/lib/datetime';

interface SpeedChartProps {
  data: SpeedResult[];
  settings: Settings | null;
  range: TimeRange;
  onRangeChange: (r: TimeRange) => void;
  compact?: boolean;
}

const RANGES: { label: string; value: TimeRange }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
];

function CustomTooltip({ active, payload, label, unit, timezone }: any) {
  if (!active || !payload?.length) return null;
  const ul = unitLabel(unit);

  return (
    <div className="border border-border bg-card px-3 py-2 text-xs space-y-1">
      <p className="text-muted-foreground mb-1">{formatActivityTime(String(label), timezone)}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums" style={{ color: p.color }}>
            {p.value != null ? `${Number(p.value).toFixed(unit === 'MBps' ? 2 : 1)} ${ul}` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SpeedChart({ data, settings, range, onRangeChange, compact = false }: SpeedChartProps) {
  const { unit } = useUnit();
  const ul = unitLabel(unit);
  const timezone = settings?.display_timezone;

  const chartData = data.map((r) => ({
    timestamp: r.timestamp,
    download: toDisplaySpeed(r.download_mbps, unit),
    upload: toDisplaySpeed(r.upload_mbps, unit),
  }));

  const planDisplayVal = settings ? toDisplaySpeed(settings.plan_download_mbps, unit) ?? 0 : 0;
  const maxRaw = Math.max(
    planDisplayVal * 1.2,
    ...chartData.map((r) => r.download ?? 0),
  );
  const maxY = Math.ceil(maxRaw / 5) * 5;

  return (
    <div className="border border-border bg-card animate-in fade-in-0 duration-500">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Speed History ({ul})
        </span>
        {!compact && (
          <Tabs value={range} onValueChange={(v) => onRangeChange(v as TimeRange)}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r.value} value={r.value}>{r.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      <div className={compact ? 'p-4 h-48' : 'p-4 h-64'}>
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No data yet — run a speed test to get started
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradDl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--metric-download))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--metric-download))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradUl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--metric-upload))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--metric-upload))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(v) => formatChartTick(v, range, timezone)}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false} minTickGap={40}
              />
              <YAxis
                domain={[0, maxY]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => unit === 'MBps' ? v.toFixed(1) : String(v)}
              />
              <Tooltip content={<CustomTooltip unit={unit} timezone={timezone} />} />
              {!compact && (
                <Legend
                  wrapperStyle={{ fontSize: 11, fontFamily: 'monospace', paddingTop: 8 }}
                  formatter={(v) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{v}</span>}
                />
              )}
              {settings && (
                <ReferenceLine
                  y={planDisplayVal}
                  stroke="hsl(var(--destructive))"
                  strokeDasharray="6 3"
                  strokeOpacity={0.7}
                  label={{ value: `plan ${planDisplayVal.toFixed(unit === 'MBps' ? 1 : 0)}`, fill: 'hsl(var(--destructive))', fontSize: 10, fontFamily: 'monospace', position: 'insideTopRight' }}
                />
              )}
              <Area
                type="monotone" dataKey="download" name={`Download (${ul})`}
                stroke="hsl(var(--metric-download))" strokeWidth={1.5} fill="url(#gradDl)"
                dot={false} activeDot={{ r: 3, fill: 'hsl(var(--metric-download))' }} connectNulls={true}
                isAnimationActive animationDuration={800} animationEasing="ease-out"
              />
              <Area
                type="monotone" dataKey="upload" name={`Upload (${ul})`}
                stroke="hsl(var(--metric-upload))" strokeWidth={1.5} fill="url(#gradUl)"
                dot={false} activeDot={{ r: 3, fill: 'hsl(var(--metric-upload))' }} connectNulls={true}
                isAnimationActive animationDuration={1000} animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
