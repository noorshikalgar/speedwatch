import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Download, ExternalLink, Info, Plus, Save, Upload, X } from 'lucide-react';
import { backupApi, settingsApi, type Settings } from '@/api/client';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnit } from '@/contexts/unit';
import { unitLabel, mbpsFromDisplay, toDisplaySpeed, speedEquivalent } from '@/lib/utils';

const INTERVALS = [
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: '6 hours', value: 360 },
  { label: '12 hours', value: 720 },
  { label: '24 hours', value: 1440 },
];

const RETENTION_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days (default)', value: 90 },
  { label: '180 days (max)', value: 180 },
];

const TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const SPEED_TEST_PROVIDERS = [
  { label: 'Cloudflare', value: 'cloudflare' },
  { label: 'Google', value: 'google' },
  { label: 'Ookla Speedtest', value: 'ookla' },
  { label: 'LibreSpeed', value: 'librespeed' },
] as const;

export function SettingsPage() {
  const qc = useQueryClient();
  const { unit } = useUnit();
  const ul = unitLabel(unit);

  const { data: remote } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [form, setForm] = useState<Settings | null>(null);
  const [newSite, setNewSite] = useState('');
  const [editingSiteIndex, setEditingSiteIndex] = useState<number | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (remote && !form) setForm(remote);
  }, [remote]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<Settings>) => settingsApi.update(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const importMutation = useMutation({
    mutationFn: (data: unknown) => backupApi.importConfig(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['sites-summary'] });
      setForm(null);
      setImportFileName('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (!form) return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
    </div>
  );

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => f ? { ...f, [key]: value } : f);
  }

  function addSite() {
    const url = newSite.trim();
    if (!url || !url.startsWith('http')) return;
    if (editingSiteIndex != null) {
      set('latency_sites', form!.latency_sites.map((site, idx) => idx === editingSiteIndex ? url : site));
      setEditingSiteIndex(null);
    } else {
      set('latency_sites', [...form!.latency_sites, url]);
    }
    setNewSite('');
  }

  function removeSite(i: number) {
    set('latency_sites', form!.latency_sites.filter((_, idx) => idx !== i));
    if (editingSiteIndex === i) {
      setEditingSiteIndex(null);
      setNewSite('');
    }
  }

  function editSite(i: number) {
    setEditingSiteIndex(i);
    setNewSite(form!.latency_sites[i]);
  }

  async function importConfigFile(file: File | undefined) {
    if (!file) return;
    setImportFileName(file.name);
    const text = await file.text();
    importMutation.mutate(JSON.parse(text));
  }

  // Plan speed: form always stores Mbps internally; display in current unit
  const dlDisplay = toDisplaySpeed(form.plan_download_mbps, unit) ?? 0;
  const ulDisplay = toDisplaySpeed(form.plan_upload_mbps, unit) ?? 0;

  function setDl(displayVal: number) {
    set('plan_download_mbps', mbpsFromDisplay(displayVal, unit));
  }
  function setUl(displayVal: number) {
    set('plan_upload_mbps', mbpsFromDisplay(displayVal, unit));
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-3 py-5 animate-in fade-in-0 duration-300 sm:px-4 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-sm font-semibold uppercase tracking-widest">Settings</h1>
          <Button onClick={() => form && saveMutation.mutate(form)} disabled={saveMutation.isPending} size="sm" className="gap-2">
            {saved ? <><CheckCircle className="h-3.5 w-3.5" /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save Changes</>}
          </Button>
        </div>

        <Tabs defaultValue="speed" className="space-y-5">
          <TabsList className="grid w-full grid-cols-2 sm:flex sm:flex-wrap sm:justify-start">
            <TabsTrigger value="speed">Speed</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="display">Display</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>

          <TabsContent value="speed" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Plan Speed</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="dl">Download ({ul})</Label>
                    <Input id="dl" type="number" min={0.1} step={unit === 'MBps' ? 0.1 : 1} value={unit === 'MBps' ? dlDisplay.toFixed(2) : dlDisplay.toFixed(0)} onChange={(e) => setDl(parseFloat(e.target.value) || 0)} />
                    <p className="text-[11px] text-muted-foreground">= {speedEquivalent(form.plan_download_mbps, unit)}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ul">Upload ({ul})</Label>
                    <Input id="ul" type="number" min={0.1} step={unit === 'MBps' ? 0.1 : 1} value={unit === 'MBps' ? ulDisplay.toFixed(2) : ulDisplay.toFixed(0)} onChange={(e) => setUl(parseFloat(e.target.value) || 0)} />
                    <p className="text-[11px] text-muted-foreground">= {speedEquivalent(form.plan_upload_mbps, unit)}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="threshold">Alert Threshold (%)</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <Input id="threshold" type="number" min={5} max={80} className="w-full sm:w-24" value={form.alert_threshold_pct} onChange={(e) => set('alert_threshold_pct', parseInt(e.target.value) || 20)} />
                    <span className="text-xs text-muted-foreground">Alert when speed drops below {100 - form.alert_threshold_pct}% of plan</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Test Schedule</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Label>Run speed test every</Label>
                <Select value={String(form.test_interval_minutes)} onValueChange={(v) => set('test_interval_minutes', parseInt(v, 10))}>
                  <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>{INTERVALS.map((i) => <SelectItem key={i.value} value={String(i.value)}>{i.label}</SelectItem>)}</SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Speed Test Server</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select value={form.speed_test_provider} onValueChange={(v) => set('speed_test_provider', v as Settings['speed_test_provider'])} disabled={form.speed_test_auto_round_robin}>
                      <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>{SPEED_TEST_PROVIDERS.map((provider) => <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-start gap-2 pb-2">
                    <Switch id="speed-test-auto-round-robin" checked={form.speed_test_auto_round_robin} onCheckedChange={(checked) => set('speed_test_auto_round_robin', checked)} />
                    <Label htmlFor="speed-test-auto-round-robin" className="text-xs text-muted-foreground">Auto select server round robin for each test</Label>
                  </div>
                </div>
                {form.speed_test_auto_round_robin && (
                  <p className="text-xs text-muted-foreground">Round robin uses Cloudflare, Google, and Ookla. LibreSpeed is included only when a LibreSpeed URL is configured.</p>
                )}
                {form.speed_test_provider === 'ookla' && !form.speed_test_auto_round_robin && <p className="text-xs text-muted-foreground">Ookla requires the official speedtest CLI on the server.</p>}
                {(form.speed_test_provider === 'librespeed' || form.speed_test_auto_round_robin) && (
                  <div className="space-y-2">
                    <Label htmlFor="librespeed-server-url">LibreSpeed server URL</Label>
                    <Input id="librespeed-server-url" placeholder="https://speed.example.com" value={form.librespeed_server_url} onChange={(e) => set('librespeed_server_url', e.target.value)} />
                    <div className="flex items-start gap-2 border border-info/25 bg-info/10 px-3 py-2 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                      <p>
                        LibreSpeed is an open-source speed test you can self-host. Point this at your LibreSpeed frontend URL; SpeedWatch checks `/backend` and root layouts.
                        {' '}
                        <a className="inline-flex items-center gap-1 text-primary hover:underline" href="https://github.com/librespeed/speedtest" target="_blank" rel="noopener noreferrer">
                          Setup guide <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monitoring" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Latency Monitoring</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">Sites checked after each speed test.</p>
                <div className="flex flex-wrap gap-2">
                  {form.latency_sites.map((site, i) => (
                    <div
                      key={`${site}-${i}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => editSite(i)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editSite(i); } }}
                      className="group inline-flex max-w-full cursor-pointer items-center gap-2 border border-border bg-muted px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
                    >
                      <span className="max-w-[220px] truncate">{site}</span>
                      <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${site}`} onClick={(event) => { event.stopPropagation(); removeSite(i); }}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input placeholder="https://example.com" value={newSite} onChange={(e) => setNewSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSite()} className="text-xs" />
                  <Button variant="outline" size="sm" onClick={addSite} className="gap-1.5 shrink-0">
                    <Plus className="h-3.5 w-3.5" /> {editingSiteIndex == null ? 'Add' : 'Update'}
                  </Button>
                  {editingSiteIndex != null && <Button variant="ghost" size="sm" onClick={() => { setEditingSiteIndex(null); setNewSite(''); }}>Cancel</Button>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Public Status Page</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <Switch id="public-status-enabled" checked={form.public_status_enabled} onCheckedChange={(checked) => set('public_status_enabled', checked)} />
                  <Label htmlFor="public-status-enabled">Enable read-only public status page</Label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="public-status-title">Status page title</Label>
                    <Input id="public-status-title" value={form.public_status_title} onChange={(e) => set('public_status_title', e.target.value)} />
                  </div>
                  <div className="flex items-end gap-2 pb-2">
                    <Switch id="public-status-show-latency" checked={form.public_status_show_latency} onCheckedChange={(checked) => set('public_status_show_latency', checked)} />
                    <Label htmlFor="public-status-show-latency">Show latency on status page</Label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="public-status-message">Status page message</Label>
                  <Input id="public-status-message" placeholder="Optional public note" value={form.public_status_message} onChange={(e) => set('public_status_message', e.target.value)} />
                </div>
                <code className="block border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">/status</code>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="alerts" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2">
                  <Switch id="notifications-enabled" checked={form.notifications_enabled} onCheckedChange={(checked) => set('notifications_enabled', checked)} />
                  <Label htmlFor="notifications-enabled">Enable webhook alerts</Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notification-webhook">Webhook URL</Label>
                  <Input id="notification-webhook" placeholder="Discord, Slack, n8n, Make, or any JSON webhook" value={form.notification_webhook_url} onChange={(e) => set('notification_webhook_url', e.target.value)} />
                  <p className="text-xs text-muted-foreground">SpeedWatch posts JSON with `content`, `text`, `event`, and `details` fields.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert-cooldown">Alert cooldown minutes</Label>
                  <Input id="alert-cooldown" type="number" min={0} className="w-full sm:w-48" value={form.alert_cooldown_minutes} onChange={(e) => set('alert_cooldown_minutes', parseInt(e.target.value, 10) || 0)} />
                  <p className="text-xs text-muted-foreground">Prevents repeated webhook alerts for the same event target.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ['notify_site_down', 'Site down'],
                    ['notify_site_slow', 'Site slow'],
                    ['notify_speed_low', 'Speed below plan'],
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2 border border-border bg-background px-3 py-2">
                      <Switch id={key} checked={Boolean(form[key as keyof Settings])} onCheckedChange={(checked) => set(key as keyof Settings, checked as never)} />
                      <Label htmlFor={key} className="text-xs">{label}</Label>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="display" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Display</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="display-timezone">Timezone</Label>
                  <Input id="display-timezone" list="timezone-options" value={form.display_timezone} onChange={(e) => set('display_timezone', e.target.value)} className="w-full sm:w-64" />
                  <datalist id="timezone-options">{TIMEZONE_OPTIONS.map((tz) => <option key={tz} value={tz} />)}</datalist>
                  <p className="text-xs text-muted-foreground">Timestamps use this IANA timezone.</p>
                </div>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Switch id="github-star-enabled" checked={form.github_star_enabled} onCheckedChange={(checked) => set('github_star_enabled', checked)} />
                    <Label htmlFor="github-star-enabled">Show GitHub star link in header</Label>
                  </div>
                  <div className="space-y-2">
                    <Label>GitHub repository</Label>
                    <div className="border border-border bg-background px-3 py-2 text-sm text-foreground">
                      https://github.com/noorshikalgar/speedwatch
                    </div>
                    <p className="text-xs text-muted-foreground">This project link is fixed. You can hide the header link if you do not want it visible.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Data Retention</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Label>Keep results for</Label>
                <Select value={String(form.retention_days)} onValueChange={(v) => set('retention_days', parseInt(v, 10))}>
                  <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>{RETENTION_OPTIONS.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Backup / Import</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" size="sm" className="gap-2" asChild>
                  <a href={backupApi.exportUrl()}><Download className="h-3.5 w-3.5" /> Export Config</a>
                </Button>
                <div className="space-y-2">
                  <Label htmlFor="config-import">Import config file</Label>
                  <Input
                    id="config-import"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => importConfigFile(event.target.files?.[0])}
                    disabled={importMutation.isPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Select a `speedwatch-config-*.json` export file. Settings and site definitions will be imported.
                  </p>
                  {importFileName && <p className="text-xs text-muted-foreground">Selected: {importFileName}</p>}
                </div>
                {importMutation.isPending && (
                  <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Upload className="h-3.5 w-3.5 animate-pulse" /> Importing config…
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
