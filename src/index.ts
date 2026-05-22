import { config } from './config';
import { logger } from './db/logger';
import { connectMongo, ensureIndexes } from './db/mongo';
import { connectRedis } from './db/redis';
import { ServiceFactory } from './factory/service.factory';
import { WorkerFactory } from './factory/worker.factory';
import { createApp } from './app';

async function main() {
  logger.info({ name: config.app.name, env: config.app.environment }, 'Starting server');

  // Connect to infrastructure
  const db = await connectMongo();
  const redis = connectRedis();

  // Ensure MongoDB indexes
  await ensureIndexes(db);

  // Wire up services via factory
  const services = new ServiceFactory(db, redis);
  const workers = new WorkerFactory(services);

  // Build Express app
  const app = createApp(services);

  // Start background workers
  workers.startAll();

  // Start HTTP server
  const server = app.listen(config.app.port, config.app.host, () => {
    logger.info({ host: config.app.host, port: config.app.port }, 'Server listening');
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    workers.stopAll();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
