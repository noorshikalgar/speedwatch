import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { SpeedTestProvider } from '@/api/client';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function speedProviderLabel(provider?: SpeedTestProvider | string | null): string {
  if (provider === 'google') return 'Google';
  if (provider === 'ookla') return 'Ookla';
  if (provider === 'librespeed') return 'LibreSpeed';
  return 'Cloudflare';
}

export type SpeedUnit = 'Mbps' | 'MBps';

export function toDisplaySpeed(mbps: number | null, unit: SpeedUnit): number | null {
  if (mbps === null || mbps === undefined) return null;
  return unit === 'MBps' ? mbps / 8 : mbps;
}

export function fmtSpeed(mbps: number | null, unit: SpeedUnit): string {
  const v = toDisplaySpeed(mbps, unit);
  if (v === null) return '—';
  return unit === 'MBps' ? v.toFixed(2) : v.toFixed(1);
}

export function unitLabel(unit: SpeedUnit): string {
  return unit === 'MBps' ? 'MB/s' : 'Mbps';
}

export function mbpsFromDisplay(display: number, unit: SpeedUnit): number {
  return unit === 'MBps' ? display * 8 : display;
}

export function speedEquivalent(mbps: number, unit: SpeedUnit): string {
  if (unit === 'Mbps') return `${(mbps / 8).toFixed(2)} MB/s`;
  return `${(mbps * 8).toFixed(1)} Mbps`;
}

export function fmtMs(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n)}`;
}

export function speedStatus(actual: number | null, plan: number, thresholdPct: number): 'good' | 'warn' | 'low' {
  if (actual === null) return 'warn';
  const ratio = actual / plan;
  if (ratio >= 1 - thresholdPct / 100) return 'good';
  if (ratio >= (1 - thresholdPct / 100) * 0.7) return 'warn';
  return 'low';
}
