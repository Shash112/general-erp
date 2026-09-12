import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function startServer() {
  const app = buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(`🚀 General ERP Monolith API running on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start API server');
    process.exit(1);
  }
}

startServer();
