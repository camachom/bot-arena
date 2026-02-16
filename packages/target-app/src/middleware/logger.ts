import type { Request, Response, NextFunction } from 'express';
import type { RequestLog, MouseMovement } from '@bot-arena/types';

export interface SessionStore {
  logs: Map<string, RequestLog[]>;
  getSessionLogs(sessionId: string): RequestLog[];
  getAllLogs(): RequestLog[];
  clear(): void;
}

const assetExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.ico'];

function isAssetRequest(path: string): boolean {
  return assetExtensions.some((ext) => path.endsWith(ext)) || path.startsWith('/assets/');
}

export function createSessionStore(): SessionStore {
  const logs = new Map<string, RequestLog[]>();

  return {
    logs,
    getSessionLogs(sessionId: string): RequestLog[] {
      return logs.get(sessionId) || [];
    },
    getAllLogs(): RequestLog[] {
      const allLogs: RequestLog[] = [];
      for (const sessionLogs of logs.values()) {
        allLogs.push(...sessionLogs);
      }
      return allLogs;
    },
    clear(): void {
      logs.clear();
    },
  };
}

export function createLoggerMiddleware(store: SessionStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip logging admin and health endpoints
    if (req.path.startsWith('/admin') || req.path === '/health') {
      next();
      return;
    }

    const sessionId = (req.headers['x-session-id'] as string) || 'unknown';

    // Parse mouse movements from header (JSON encoded)
    let mouseMovements: MouseMovement[] | undefined;
    const mouseHeader = req.headers['x-mouse-movements'] as string;
    if (mouseHeader) {
      try {
        mouseMovements = JSON.parse(mouseHeader);
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Parse dwell time from header
    const dwellTimeMs = req.headers['x-dwell-time']
      ? parseInt(req.headers['x-dwell-time'] as string, 10)
      : undefined;

    // Parse content length from previous response (sent as header)
    const contentLength = req.headers['x-prev-content-length']
      ? parseInt(req.headers['x-prev-content-length'] as string, 10)
      : undefined;

    const log: RequestLog = {
      sessionId,
      timestamp: Date.now(),
      path: req.path,
      method: req.method,
      query: req.query as Record<string, string>,
      userAgent: req.headers['user-agent'] || '',
      isAssetRequest: isAssetRequest(req.path),
      mouseMovements,
      dwellTimeMs,
      contentLength,
    };

    if (!store.logs.has(sessionId)) {
      store.logs.set(sessionId, []);
    }
    store.logs.get(sessionId)!.push(log);

    next();
  };
}
