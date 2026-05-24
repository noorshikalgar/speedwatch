import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import type { SpeedResult, Settings, LatencyCheck } from '@/api/client';
import { toDisplaySpeed, unitLabel } from '@/lib/utils';
import { useUnit } from '@/contexts/unit';
import { formatActivityTime, formatChartTick } from '@/lib/datetime';

interface CombinedChartProps {
  speedData: SpeedResult[];
  latencyData: LatencyCheck[];
  settings: Settings | null;
}

const SITE_PALETTE = [
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

type MergedRow = { timestamp: string } & Record<string, number | null | string>;

function mergeData(
  speedData: SpeedResult[],
  latencyData: LatencyCheck[],
  unit: ReturnType<typeof unitLabel> extends string ? any : never,
  unitRaw: Parameters<typeof toDisplaySpeed>[1],
): { rows: MergedRow[]; siteKeys: string[] } {
  // bucket key = YYYY-MM-DD HH:MM
  const bucket = (ts: string) => ts.substring(0, 16);

  const map = new Map<string, MergedRow>();

  // seed from speed results
  for (const r of speedData) {
    const key = bucket(r.timestamp);
    map.set(key, {
      timestamp: key,
      download: toDisplaySpeed(r.download_mbps, unitRaw),
      upload: toDisplaySpeed(r.upload_mbps, unitRaw),
      ping: r.ping_ms,
    });
  }

  // collect unique site hostnames
  const siteUrls = [...new Set(latencyData.map(c => c.url))];
  const siteKeys = siteUrls.map(hostname);

  // merge latency checks into same buckets (or create new ones)
  for (const check of latencyData) {
    const key = bucket(check.timestamp);
    const host = hostname(check.url);
    if (!map.has(key)) {
      map.set(key, { timestamp: key, download: null, upload: null, ping: null });
    }
    const row = map.get(key)!;
    // keep the best (lowest) value if multiple checks fall in same minute
    const cur = row[host] as number | null;
    const val = check.status === 'ok' ? check.latency_ms : null;
    row[host] = (cur === null || cur === undefined) ? val : (val !== null ? Math.min(cur, val) : cur);
  }

  const rows = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  return { rows, siteKeys };
}

function CustomTooltip({ active, payload, label, unitRaw, timezone }: any) {
  if (!active || !payload?.length) return null;
  const ul = unitLabel(unitRaw);

  const speedKeys = new Set(['download', 'upload']);
  const pingKey = 'ping';

  return (
    <div className="border border-border bg-card px-3 py-2 text-xs space-y-1 min-w-[180px]">
      <p className="text-muted-foreground mb-1">{formatActivityTime(String(label), timezone)}</p>
      {payload.map((p: any) => {
        const isSpeed = speedKeys.has(p.dataKey);
        const isPing = p.dataKey === pingKey;
        const valStr = p.value == null ? '—'
          : isSpeed ? `${Number(p.value).toFixed(unitRaw === 'MBps' ? 2 : 1)} ${ul}`
          : `${Number(p.value).toFixed(0)} ms`;
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 shrink-0" style={{ background: p.color }} />
              <span className="text-muted-foreground truncate max-w-[90px]">{p.name}</span>
            </div>
            <span className="font-medium tabular-nums shrink-0" style={{ color: p.color }}>{valStr}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CombinedChart({ speedData, latencyData, settings }: CombinedChartProps) {
  const { unit } = useUnit();
  const ul = unitLabel(unit);
  const timezone = settings?.display_timezone;

  const { rows, siteKeys } = mergeData(speedData, latencyData, ul, unit);

  const planVal = settings ? (toDisplaySpeed(settings.plan_download_mbps, unit) ?? 0) : 0;
  const maxSpeed = Math.ceil(Math.max(planVal * 1.15, ...rows.map(r => (r.download as number) ?? 0)) / 5) * 5 || 100;

  const allPingVals = rows.flatMap(r => {
    const vals: number[] = [];
    if (r.ping != null) vals.push(r.ping as number);
    for (const k of siteKeys) if (r[k] != null) vals.push(r[k] as number);
    return vals;
  });
  const maxPing = Math.ceil(Math.max(50, ...allPingVals) / 10) * 10;

  const hasData = rows.length > 0;

  return (
    <div className="border border-border bg-card animate-in fade-in-0 duration-500">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground mr-auto">
          Speed + Latency — 24h
        </span>
        {/* inline legend */}
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-5 bg-metric-download/60" />
            DL ({ul})
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-5 bg-metric-upload/60" />
            UL ({ul})
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-5 border-t-2 border-metric-latency border-dashed" />
            Ping
          </span>
          {siteKeys.map((k, i) => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-5 border-t-2 border-dashed" style={{ borderColor: SITE_PALETTE[i % SITE_PALETTE.length] }} />
              {k}
            </span>
          ))}
        </div>
      </div>

      <div className="p-4 h-64">
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No data yet — run a speed test to get started
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 36, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="cgDl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--metric-download))" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(var(--metric-download))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cgUl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--metric-upload))" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(var(--metric-upload))" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />

              <XAxis
                dataKey="timestamp"
                tickFormatter={(v) => formatChartTick(v, '24h', timezone)}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false} minTickGap={50}
              />

              {/* Left — speed */}
              <YAxis
                yAxisId="speed" orientation="left"
                domain={[0, maxSpeed]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => unit === 'MBps' ? v.toFixed(1) : String(v)}
              />

              {/* Right — latency ms (ping + all sites) */}
              <YAxis
                yAxisId="latency" orientation="right"
                domain={[0, maxPing]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
                width={38}
                tickFormatter={(v) => `${v}`}
              />

              <Tooltip content={<CustomTooltip unitRaw={unit} timezone={timezone} />} />

              {/* Speed areas */}
              <Area
                yAxisId="speed" type="monotone" dataKey="download" name={`Download`}
                stroke="hsl(var(--metric-download))" strokeWidth={1.5} fill="url(#cgDl)"
                dot={false} activeDot={{ r: 3 }} connectNulls={true}
                isAnimationActive animationDuration={800} animationEasing="ease-out"
              />
              <Area
                yAxisId="speed" type="monotone" dataKey="upload" name={`Upload`}
                stroke="hsl(var(--metric-upload))" strokeWidth={1.5} fill="url(#cgUl)"
                dot={false} activeDot={{ r: 3 }} connectNulls={true}
                isAnimationActive animationDuration={1000} animationEasing="ease-out"
              />

              {/* Ping from speed test */}
              <Line
                yAxisId="latency" type="monotone" dataKey="ping" name="Ping"
                stroke="hsl(var(--metric-latency))" strokeWidth={1.5} strokeDasharray="4 3"
                dot={false} activeDot={{ r: 3 }} connectNulls={true}
                isAnimationActive animationDuration={1200} animationEasing="ease-out"
              />

              {/* Per-site latency lines */}
              {siteKeys.map((key, i) => (
                <Line
                  key={key}
                  yAxisId="latency" type="monotone" dataKey={key} name={key}
                  stroke={SITE_PALETTE[i % SITE_PALETTE.length]}
                  strokeWidth={1.5} strokeDasharray="2 3"
                  dot={false} activeDot={{ r: 3 }} connectNulls={false}
                  isAnimationActive animationDuration={1200 + i * 150} animationEasing="ease-out"
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
