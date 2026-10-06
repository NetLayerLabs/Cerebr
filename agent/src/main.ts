// Cerebr Agent keeper daemon. Every INTERVAL_SEC: observe the CerebrAgent, and if it may act, send act()
// from the hot wallet (see runner.ts). Run with `node src/main.ts` (Node >= 24.12 runs TypeScript natively).
// Configuration is environment-only; see .env.example and README.md.

import { loadConfig, publicConfig } from './config.ts';
import { startHealthServer } from './health.ts';
import { log } from './log.ts';
import { Runner } from './runner.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  log('info', 'start', { config: publicConfig(cfg) });
  if (cfg.network === 'xlayer' && !cfg.dryRun) log('warn', 'mainnet', { note: 'NETWORK=xlayer: this daemon sends real transactions and spends OKB from the hot wallet' });

  const runner = await Runner.create(cfg);
  await runner.preflight();
  const server = startHealthServer(runner, cfg.healthHost, cfg.healthPort);

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('info', 'shutdown.requested', { signal });
    wake?.();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('unhandledRejection', (e) => log('error', 'unhandled_rejection', { error: e as Error }));

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  while (!stopping) {
    let delayMs = cfg.intervalSec * 1000;
    try {
      const res = await runner.tick();
      log('info', 'cycle', { ...res });
    } catch {
      // backoff for transient failures: 15s, 30s, 60s, ... capped at the interval
      delayMs = Math.min(delayMs, 15_000 * 2 ** Math.min(runner.consecutiveErrors - 1, 10));
    }
    if (cfg.maxCycles && runner.counters.cycles >= cfg.maxCycles) break;
    if (stopping) break;
    runner.nextRunAt = Date.now() + delayMs;
    await sleep(delayMs);
  }

  await runner.drain();
  runner.status = 'stopped';
  await new Promise<void>((r) => server.close(() => r()));
  log('info', 'stopped', { counters: runner.counters });
}

main().catch((e) => {
  log('error', 'fatal', { error: e as Error });
  process.exit(1);
});
