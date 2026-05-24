import { ArrowDown, ArrowUp, Clock, Waves } from 'lucide-react';
import { Card, CardContent, CardTitle } from './ui/card';
import { fmtSpeed, fmtMs, speedStatus, unitLabel } from '@/lib/utils';
import { useUnit } from '@/contexts/unit';
import type { SpeedResult, Settings } from '@/api/client';
import { cn } from '@/lib/utils';

interface StatCardsProps {
  latest: SpeedResult | null;
  settings: Settings | null;
}

function StatusDot({ status }: { status: 'good' | 'warn' | 'low' }) {
  return (
    <span className={cn('inline-block h-2 w-2 rounded-full', {
      'bg-warning': status === 'warn',
      'bg-destructive': status === 'low',
      'bg-success': status === 'good',
    })} />
  );
}

export function StatCards({ latest, settings }: StatCardsProps) {
  const { unit } = useUnit();
  const planDl = settings?.plan_download_mbps ?? 100;
  const planUl = settings?.plan_upload_mbps ?? 50;
  const threshold = settings?.alert_threshold_pct ?? 20;

  const dlStatus = speedStatus(latest?.download_mbps ?? null, planDl, threshold);
  const ulStatus = speedStatus(latest?.upload_mbps ?? null, planUl, threshold);
  const ul = unitLabel(unit);

  const cards = [
    {
      label: 'Download',
      value: fmtSpeed(latest?.download_mbps ?? null, unit),
      unit: ul,
      icon: ArrowDown,
      color: 'text-metric-download',
      motion: 'stat-icon-download',
      status: dlStatus,
      planMbps: planDl,
    },
    {
      label: 'Upload',
      value: fmtSpeed(latest?.upload_mbps ?? null, unit),
      unit: ul,
      icon: ArrowUp,
      color: 'text-metric-upload',
      motion: 'stat-icon-upload',
      status: ulStatus,
      planMbps: planUl,
    },
    {
      label: 'Ping',
      value: fmtMs(latest?.ping_ms ?? null),
      unit: 'ms',
      icon: Clock,
      color: 'text-metric-latency',
      motion: 'stat-icon-ping',
      status: null,
      planMbps: null,
    },
    {
      label: 'Jitter',
      value: fmtMs(latest?.jitter_ms ?? null),
      unit: 'ms',
      icon: Waves,
      color: 'text-metric-jitter',
      motion: 'stat-icon-jitter',
      status: null,
      planMbps: null,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border animate-in fade-in-0 duration-500">
      {cards.map((card) => (
        <Card key={card.label} className="border-0">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <CardTitle>{card.label}</CardTitle>
              <div className="flex items-center gap-1.5">
                {card.status && <StatusDot status={card.status} />}
                <card.icon className={cn('h-4 w-4', card.color, card.motion)} />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={cn('text-3xl font-semibold tabular-nums', card.value === '—' && 'text-muted-foreground')}>
                {card.value}
              </span>
              <span className="text-xs text-muted-foreground">{card.unit}</span>
            </div>
            {card.planMbps !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                plan: {fmtSpeed(card.planMbps, unit)} {ul}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
