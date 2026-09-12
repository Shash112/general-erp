import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import crypto from 'crypto';
import { env } from './config/env.js';
import { setupErrorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.routes.js';
import { fiscalPeriodRoutes } from './routes/fiscal-period.routes.js';
import { chartOfAccountsRoutes } from './routes/chart-of-accounts.routes.js';
import { glRoutes } from './routes/gl.routes.js';
import { accountingCoreRoutes } from './routes/accounting-core.routes.js';
import { taxRoutes } from './routes/tax.routes.js';
import { arRoutes } from './routes/ar.routes.js';
import { apRoutes } from './routes/ap.routes.js';
import { bankingRoutes } from './routes/banking.routes.js';
import { reportingRoutes } from './routes/reporting.routes.js';
import { commercialRoutes } from './routes/commercial.routes.js';
import { salesRoutes } from './routes/sales.routes.js';
import { salesOrderRoutes } from './routes/sales-order.routes.js';
import { salesDeliveryRoutes } from './routes/sales-delivery.routes.js';
import { accountingEngine } from './platform/accounting/accounting.service.js';

import { authorizationService } from './platform/authorization/authorization.service.js';
import { auditService } from './platform/audit/audit.service.js';
import { RequestContext, UserSession } from '@general-erp/core';

export function buildApp() {
  const app = Fastify({
    logger: false, // We use custom Pino logger
    genReqId: () => crypto.randomUUID()
  });

  // Register Plugins
  app.register(cors, { origin: true, credentials: true });
  app.register(cookie, { secret: env.SESSION_SECRET });

  // Add Correlation ID Header Middleware
  app.addHook('onRequest', async (request, reply) => {
    const reqId = (request.headers['x-request-id'] as string) || request.id;
    reply.header('X-Request-ID', reqId);
  });

  // Global Error Handler
  app.setErrorHandler(setupErrorHandler);

  // Register Health & Finance & Commercial Routes
  app.register(healthRoutes);
  app.register(fiscalPeriodRoutes);
  app.register(chartOfAccountsRoutes);
  app.register(glRoutes);
  app.register(accountingCoreRoutes);
  app.register(taxRoutes);
  app.register(arRoutes);
  app.register(apRoutes);
  app.register(bankingRoutes);
  app.register(reportingRoutes);
  app.register(commercialRoutes);
  app.register(salesRoutes);
  app.register(salesOrderRoutes);
  app.register(salesDeliveryRoutes);



  // Phase 0 Verification & Test API Routes (/api/v1)
  app.register(async (v1) => {
    // 1. Accounting Engine Verification Route
    v1.post('/accounting/verify-journal', async (request, reply) => {
      const body = request.body as any;
      const ctx: RequestContext = {
        requestId: request.id,
        tenantId: body.tenantId || 'tenant_demo',
        companyId: body.companyId || 'company_demo',
        ip: request.ip,
        userAgent: request.headers['user-agent'] || 'test',
        timestamp: new Date()
      };

      const result = await accountingEngine.processAccountingEvent(ctx, body.event);
      return reply.send({ success: true, data: result });
    });

    // 2. Authorization Service Verification Route
    v1.post('/auth/check-permission', async (request, reply) => {
      const body = request.body as any;
      const user: UserSession = body.user;
      const isAllowed = authorizationService.authorize({
        user,
        action: body.action,
        companyId: body.companyId,
        creatorId: body.creatorId
      });
      return reply.send({ success: true, data: { isAllowed } });
    });

    // 3. Audit Engine Verification Route
    v1.post('/audit/log', async (request, reply) => {
      const body = request.body as any;
      const ctx: RequestContext = {
        requestId: request.id,
        tenantId: body.tenantId || 'tenant_demo',
        companyId: 'company_demo',
        ip: request.ip,
        userAgent: request.headers['user-agent'] || 'test',
        timestamp: new Date()
      };

      const result = await auditService.logEvent(ctx, body.log);
      return reply.send({ success: true, data: result });
    });
  }, { prefix: '/api/v1' });

  return app;
}
