import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Settings, Zap, Monitor } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useUnit } from '@/contexts/unit';
import { useTheme, THEME_LIST, THEME_LABELS, type Theme } from '@/contexts/theme';

interface HeaderProps {
  isRunning?: boolean;
  nextRun?: string | null;
  timezone?: string | null;
}

const THEME_ICONS: Record<Theme, string> = {
  void: '◉',
  midnight: '☾',
  graphite: '▦',
  ember: '✦',
  japan: '◒',
  terminal: '⬛',
  paper: '□',
};

function fmtCountdown(nextRun: string): string {
  const diff = Math.max(0, new Date(nextRun).getTime() - Date.now());
  const secs = Math.floor(diff / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Header({ isRunning, nextRun }: HeaderProps) {
  const location = useLocation();
  const onSettings = location.pathname === '/settings';
  const { unit, setUnit } = useUnit();
  const { theme, setTheme } = useTheme();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!nextRun) return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [nextRun]);

  function cycleTheme() {
    const idx = THEME_LIST.indexOf(theme);
    setTheme(THEME_LIST[(idx + 1) % THEME_LIST.length]);
  }

  const isNextRunDue = nextRun ? new Date(nextRun).getTime() <= Date.now() : false;
  const showCountdown = !!nextRun && !isRunning && !isNextRunDue;

  return (
    <header className="border-b border-border bg-card px-4 py-2.5 flex items-center justify-between">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2.5 group">
        <Zap className="h-4 w-4 text-primary transition-transform group-hover:scale-110" />
        <span className="text-sm font-semibold tracking-widest uppercase text-foreground group-hover:text-primary transition-colors">
          SpeedWatch
        </span>
      </Link>

      <div className="flex items-center gap-1.5">
        {/* right side: countdown + testing indicator */}
        {showCountdown && (
          <span className="hidden md:inline-flex items-center gap-1.5 border border-success/35 bg-success/10 px-2 py-1 text-[11px] uppercase tracking-wider tabular-nums mr-1">
            <span className="text-success/75">next in</span>
            <span className="text-success">{fmtCountdown(nextRun)}</span>
          </span>
        )}
        {isRunning && (
          <span className="hidden md:inline-flex items-center gap-1.5 border border-warning/35 bg-warning/10 px-2 py-1 text-[11px] uppercase tracking-wider text-warning mr-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
            testing…
          </span>
        )}

        {/* Unit toggle */}
        <div className="flex items-center border border-border overflow-hidden text-xs">
          <button
            onClick={() => setUnit('Mbps')}
            className={cn('px-2.5 py-1 transition-colors', unit === 'Mbps' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
          >
            Mbps
          </button>
          <button
            onClick={() => setUnit('MBps')}
            className={cn('px-2.5 py-1 transition-colors', unit === 'MBps' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
          >
            MB/s
          </button>
        </div>

        {/* Theme cycle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleTheme}
          className="gap-1.5 text-xs px-2.5 h-7"
          title={`Theme: ${THEME_LABELS[theme]}`}
          aria-label={`Switch theme from ${THEME_LABELS[theme]}`}
        >
          <Monitor className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{THEME_ICONS[theme]}</span>
        </Button>

        {/* Settings link */}
        <Button variant={onSettings ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7" asChild>
          <Link to={onSettings ? '/' : '/settings'} aria-label="Settings">
            <Settings className={cn('h-3.5 w-3.5', onSettings && 'text-primary')} />
          </Link>
        </Button>
      </div>
    </header>
  );
}
