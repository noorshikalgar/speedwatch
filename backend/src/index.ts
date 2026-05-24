import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import speedsRouter from './routes/speeds.js';
import settingsRouter from './routes/settings.js';
import latencyRouter from './routes/latency.js';
import sitesRouter from './routes/sites.js';
import metricsRouter from './routes/metrics.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3005;

app.use(cors());
app.use(express.json());

app.use('/api/speeds', speedsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/latency', latencyRouter);
app.use('/api/sites', sitesRouter);
app.use('/metrics', metricsRouter);

// Serve built frontend in production
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`SpeedWatch backend running on http://localhost:${PORT}`);
  startScheduler();
});
