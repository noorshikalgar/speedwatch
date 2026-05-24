import { Router } from 'express';
import { getAllSettings, listMySites, setSetting, createMySite } from '../db.js';

const router = Router();

function backupName() {
  return `speedwatch-config-${new Date().toISOString().slice(0, 10)}.json`;
}

router.get('/config.json', (_req, res) => {
  res.attachment(backupName());
  res.json({
    exported_at: new Date().toISOString(),
    version: 1,
    settings: getAllSettings(),
    sites: listMySites(),
  });
});

router.post('/config', (req, res) => {
  const body = req.body as { settings?: Record<string, unknown>; sites?: any[] };
  if (body.settings && typeof body.settings === 'object') {
    for (const [key, value] of Object.entries(body.settings)) {
      setSetting(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }

  let importedSites = 0;
  if (Array.isArray(body.sites)) {
    for (const site of body.sites) {
      if (site?.url && String(site.url).startsWith('http')) {
        createMySite(site);
        importedSites += 1;
      }
    }
  }

  res.json({ success: true, imported_sites: importedSites });
});

export default router;
