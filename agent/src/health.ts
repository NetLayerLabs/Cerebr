// Tiny read-only HTTP endpoint: GET /health (200 / 503) and GET /status (JSON snapshot). No writes, no
// secrets. Bind it to 127.0.0.1 (the default) or put it behind a reverse proxy.

import { createServer, type Server } from 'node:http';
import { jsonSafe, log } from './log.ts';
import type { Runner } from './runner.ts';

export function startHealthServer(runner: Runner, host: string, port: number): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const path = (req.url ?? '/').split('?')[0];
    const snap = runner.snapshot();
    let code = 200;
    let body: unknown;
    if (path === '/health' || path === '/healthz') {
      const stale = runner.lastCycleAt !== 0 && Date.now() - runner.lastCycleAt > 3 * runner.cfg.intervalSec * 1000 + 60_000;
      const ok = (snap.status === 'running' || snap.status === 'starting') && !stale;
      code = ok ? 200 : 503;
      body = { ok, status: snap.status, stale, lastCycleAt: snap.lastCycleAt, nextRunAt: snap.nextRunAt, balanceOkb: snap.balanceOkb };
    } else if (path === '/' || path === '/status') {
      body = snap;
    } else {
      code = 404;
      body = { error: 'not found', routes: ['/health', '/status'] };
    }
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(jsonSafe(body), null, 2));
  });
  server.on('error', (e) => log('error', 'health.error', { error: e }));
  server.listen(port, host, () => log('info', 'health.listening', { host, port }));
  return server;
}
