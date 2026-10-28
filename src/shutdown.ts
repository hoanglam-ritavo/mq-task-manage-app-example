import type { Server } from 'node:http';
import type { Logger } from 'pino';
export function createShutdown(
  server: Server,
  messaging: { stop(): Promise<void> },
  logger: Logger,
  setExitCode: (code: number) => void,
) {
  let work: Promise<void> | undefined;
  return (signal: string): Promise<void> => {
    if (work) return work;
    logger.info({ signal }, 'Shutting down');
    work = (async () => {
      let failed = false;
      const http = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          failed = true;
          setExitCode(1);
          logger.error('HTTP shutdown deadline exceeded');
          server.closeAllConnections();
        }, 10000);
        timer.unref();
        server.close((error) => {
          clearTimeout(timer);
          if (error) {
            failed = true;
            logger.error('HTTP shutdown failed');
          }
          resolve();
        });
      });
      const results = await Promise.allSettled([http, messaging.stop()]);
      setExitCode(
        failed || results.some((r) => r.status === 'rejected') ? 1 : 0,
      );
    })();
    return work;
  };
}
