import { AlertTriangle } from 'lucide-react';
import type { SpeedResult, Settings } from '@/api/client';
import { speedStatus } from '@/lib/utils';

interface AlertBannerProps {
  latest: SpeedResult | null;
  settings: Settings | null;
}

export function AlertBanner({ latest, settings }: AlertBannerProps) {
  if (!latest || !settings) return null;

  const dlStatus = speedStatus(latest.download_mbps, settings.plan_download_mbps, settings.alert_threshold_pct);
  const ulStatus = speedStatus(latest.upload_mbps, settings.plan_upload_mbps, settings.alert_threshold_pct);

  const issues: string[] = [];
  if (dlStatus === 'low') issues.push(`download ${latest.download_mbps?.toFixed(1)} Mbps (plan: ${settings.plan_download_mbps})`);
  if (ulStatus === 'low') issues.push(`upload ${latest.upload_mbps?.toFixed(1)} Mbps (plan: ${settings.plan_upload_mbps})`);
  if (latest.error) issues.push(`last test error: ${latest.error}`);

  if (issues.length === 0) return null;

  return (
    <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
      <div className="text-sm text-destructive space-y-0.5">
        {issues.map((issue, i) => (
          <p key={i}>Speed below plan threshold — {issue}</p>
        ))}
      </div>
    </div>
  );
}
