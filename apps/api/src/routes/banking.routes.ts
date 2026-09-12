import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError } from '@general-erp/core';
import {
  bankAccountService,
  bankingVoucherService,
  CreateBankAccountInput,
  UpdateBankAccountInput,
  CreateCashAccountInput,
  UpdateCashAccountInput,
  CreatePaymentVoucherInput,
  CreateReceiptVoucherInput,
  CreateTransferVoucherInput,
  PostVoucherInput,
  ReverseVoucherInput,
  BankAccountType,
  AccountStatus,
  BankingVoucherStatus,
  BankingVoucherType,
  BankingSourceType
} from '../modules/finance/banking/index.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = req.headers['x-user-id'] as string | undefined;
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['banking_user'];
  const permissions = (req.headers['x-user-permissions'] as string)?.split(',') || ['*'];

  return {
    requestId: req.id || `req_${Date.now()}`,
    tenantId,
    companyId,
    ip: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'unknown',
    timestamp: new Date(),
    ...(userId ? {
      user: {
        userId,
        email: `${userId}@system.local`,
        tenantId,
        companyId,
        roles,
        permissions
      }
    } : {})
  };
}

export async function bankingRoutes(fastify: FastifyInstance): Promise<void> {

  // ==========================================
  // BANK ACCOUNTS ENDPOINTS
  // ==========================================

  // Create Bank Account
  fastify.post('/api/v1/banking/accounts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateBankAccountInput;
    const account = await bankAccountService.createBankAccount(ctx, body);
    return reply.status(201).send({ success: true, data: account });
  });

  // List Bank Accounts
  fastify.get('/api/v1/banking/accounts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; status?: AccountStatus; accountType?: BankAccountType; currency?: string };
    const companyId = query.companyId || ctx.companyId;
    if (!companyId) throw new ValidationError('Query parameter companyId is required.');
    const accounts = await bankAccountService.listBankAccounts(ctx, companyId, {
      status: query.status,
      accountType: query.accountType,
      currency: query.currency
    });
    return reply.send({ success: true, data: accounts });
  });

  // Get Bank Account
  fastify.get('/api/v1/banking/accounts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const account = await bankAccountService.getBankAccount(ctx, id);
    return reply.send({ success: true, data: account });
  });

  // Update Bank Account
  fastify.patch('/api/v1/banking/accounts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateBankAccountInput;
    const updated = await bankAccountService.updateBankAccount(ctx, id, body);
    return reply.send({ success: true, data: updated });
  });

  // Activate Bank Account
  fastify.post('/api/v1/banking/accounts/:id/activate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const activated = await bankAccountService.activateBankAccount(ctx, id);
    return reply.send({ success: true, data: activated });
  });

  // Deactivate Bank Account
  fastify.post('/api/v1/banking/accounts/:id/deactivate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const deactivated = await bankAccountService.deactivateBankAccount(ctx, id);
    return reply.send({ success: true, data: deactivated });
  });

  // Get Bank Account Derived Balance
  fastify.get('/api/v1/banking/accounts/:id/balance', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { asOfDate?: string };
    const balance = await bankAccountService.getAccountBalance(ctx, id, query.asOfDate);
    return reply.send({ success: true, data: balance });
  });

  // Get Bank Account Transaction History
  fastify.get('/api/v1/banking/accounts/:id/transactions', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { fromDate?: string; toDate?: string; limit?: string; offset?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const historyOptions: { fromDate?: string; toDate?: string; limit?: number; offset?: number } = {};
    if (query.fromDate) historyOptions.fromDate = query.fromDate;
    if (query.toDate) historyOptions.toDate = query.toDate;
    if (limit !== undefined) historyOptions.limit = limit;
    if (offset !== undefined) historyOptions.offset = offset;

    const history = await bankAccountService.getTransactionHistory(ctx, id, historyOptions);
    return reply.send({ success: true, data: history });
  });

  // ==========================================
  // CASH ACCOUNTS ENDPOINTS
  // ==========================================

  // Create Cash Account
  fastify.post('/api/v1/banking/cash-accounts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateCashAccountInput;
    const account = await bankAccountService.createCashAccount(ctx, body);
    return reply.status(201).send({ success: true, data: account });
  });

  // List Cash Accounts
  fastify.get('/api/v1/banking/cash-accounts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string; status?: AccountStatus; currency?: string };
    const companyId = query.companyId || ctx.companyId;
    if (!companyId) throw new ValidationError('Query parameter companyId is required.');
    const accounts = await bankAccountService.listCashAccounts(ctx, companyId, {
      status: query.status,
      currency: query.currency
    });
    return reply.send({ success: true, data: accounts });
  });

  // Get Cash Account
  fastify.get('/api/v1/banking/cash-accounts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const account = await bankAccountService.getCashAccount(ctx, id);
    return reply.send({ success: true, data: account });
  });

  // Update Cash Account
  fastify.patch('/api/v1/banking/cash-accounts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateCashAccountInput;
    const updated = await bankAccountService.updateCashAccount(ctx, id, body);
    return reply.send({ success: true, data: updated });
  });

  // Activate Cash Account
  fastify.post('/api/v1/banking/cash-accounts/:id/activate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const activated = await bankAccountService.activateCashAccount(ctx, id);
    return reply.send({ success: true, data: activated });
  });

  // Deactivate Cash Account
  fastify.post('/api/v1/banking/cash-accounts/:id/deactivate', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const deactivated = await bankAccountService.deactivateCashAccount(ctx, id);
    return reply.send({ success: true, data: deactivated });
  });

  // Get Cash Account Derived Balance
  fastify.get('/api/v1/banking/cash-accounts/:id/balance', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { asOfDate?: string };
    const balance = await bankAccountService.getAccountBalance(ctx, id, query.asOfDate);
    return reply.send({ success: true, data: balance });
  });

  // Get Cash Account Transaction History
  fastify.get('/api/v1/banking/cash-accounts/:id/transactions', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const query = req.query as { fromDate?: string; toDate?: string; limit?: string; offset?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;

    const historyOptions: { fromDate?: string; toDate?: string; limit?: number; offset?: number } = {};
    if (query.fromDate) historyOptions.fromDate = query.fromDate;
    if (query.toDate) historyOptions.toDate = query.toDate;
    if (limit !== undefined) historyOptions.limit = limit;
    if (offset !== undefined) historyOptions.offset = offset;

    const history = await bankAccountService.getTransactionHistory(ctx, id, historyOptions);
    return reply.send({ success: true, data: history });
  });

  // ==========================================
  // BANKING VOUCHERS ENDPOINTS
  // ==========================================

  // Create Draft Payment Voucher
  fastify.post('/api/v1/banking/vouchers/payment', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreatePaymentVoucherInput;
    const voucher = await bankingVoucherService.createDraftPayment(ctx, body);
    return reply.status(201).send({ success: true, data: voucher });
  });

  // Create Draft Receipt Voucher
  fastify.post('/api/v1/banking/vouchers/receipt', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateReceiptVoucherInput;
    const voucher = await bankingVoucherService.createDraftReceipt(ctx, body);
    return reply.status(201).send({ success: true, data: voucher });
  });

  // Create Draft Transfer Voucher
  fastify.post('/api/v1/banking/vouchers/transfer', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as CreateTransferVoucherInput;
    const voucher = await bankingVoucherService.createDraftTransfer(ctx, body);
    return reply.status(201).send({ success: true, data: voucher });
  });

  // List Vouchers
  fastify.get('/api/v1/banking/vouchers', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      status?: BankingVoucherStatus;
      voucherType?: BankingVoucherType;
      sourceType?: BankingSourceType;
      bankAccountId?: string;
      cashAccountId?: string;
      fromDate?: string;
      toDate?: string;
    };
    const companyId = query.companyId || ctx.companyId;
    if (!companyId) throw new ValidationError('Query parameter companyId is required.');
    const vouchers = await bankingVoucherService.listVouchers(ctx, companyId, query);
    return reply.send({ success: true, data: vouchers });
  });

  // Get Voucher
  fastify.get('/api/v1/banking/vouchers/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const voucher = await bankingVoucherService.getVoucher(ctx, id);
    return reply.send({ success: true, data: voucher });
  });

  // Post Voucher
  fastify.post('/api/v1/banking/vouchers/:id/post', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const body = (req.body || {}) as PostVoucherInput;
    const posted = await bankingVoucherService.postVoucher(ctx, id, {
      ...body,
      idempotencyKey: idempotencyKey || body.idempotencyKey
    });
    return reply.send({ success: true, data: posted });
  });

  // Reverse Voucher
  fastify.post('/api/v1/banking/vouchers/:id/reverse', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const body = req.body as ReverseVoucherInput;
    const reversed = await bankingVoucherService.reverseVoucher(ctx, id, {
      ...body,
      idempotencyKey: idempotencyKey || body?.idempotencyKey
    });
    return reply.send({ success: true, data: reversed });
  });

  // Cancel Voucher
  fastify.post('/api/v1/banking/vouchers/:id/cancel', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const cancelled = await bankingVoucherService.cancelDraft(ctx, id);
    return reply.send({ success: true, data: cancelled });
  });
}
