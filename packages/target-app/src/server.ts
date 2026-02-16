import express from 'express';
import { productsRouter } from './routes/products.js';
import { createLoggerMiddleware, createSessionStore, type SessionStore } from './middleware/logger.js';
import { createDetectorMiddleware, type DetectorStore } from './detector.js';

export interface TargetAppOptions {
  port?: number;
  policyPath?: string;
}

export interface TargetAppInstance {
  app: express.Application;
  sessionStore: SessionStore;
  detectorStore: DetectorStore;
  start(): Promise<{ port: number; close: () => Promise<void> }>;
}

export function createTargetApp(options: TargetAppOptions = {}): TargetAppInstance {
  const { policyPath = '../../configs/policy.yml' } = options;

  const app = express();
  const sessionStore = createSessionStore();
  const { middleware: detectorMiddleware, store: detectorStore } = createDetectorMiddleware(
    policyPath,
    sessionStore
  );

  // Middleware
  app.use(express.json());
  app.use(createLoggerMiddleware(sessionStore));
  app.use(detectorMiddleware);

  // Simulate static assets
  app.get('/assets/:file', (req, res) => {
    res.type(req.params.file.split('.').pop() || 'text/plain');
    res.send('/* asset content */');
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Products API
  app.use('/api/products', productsRouter);

  // Admin endpoints for arena
  app.get('/admin/logs', (_req, res) => {
    res.json(sessionStore.getAllLogs());
  });

  app.get('/admin/detections', (_req, res) => {
    res.json(detectorStore.getAllResults());
  });

  app.post('/admin/reset', (_req, res) => {
    sessionStore.clear();
    detectorStore.clear();
    res.json({ status: 'reset' });
  });

  app.post('/admin/reload-policy', (_req, res) => {
    detectorStore.reloadPolicy();
    res.json({ status: 'reloaded' });
  });

  return {
    app,
    sessionStore,
    detectorStore,
    async start() {
      const port = options.port || 3000;
      return new Promise((resolve) => {
        const server = app.listen(port, () => {
          resolve({
            port,
            close: () =>
              new Promise<void>((resolveClose) => {
                server.close(() => resolveClose());
              }),
          });
        });
      });
    },
  };
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createTargetApp({ port: 3000 });
  app.start().then(({ port }) => {
    console.log(`Target app running on http://localhost:${port}`);
  });
}
