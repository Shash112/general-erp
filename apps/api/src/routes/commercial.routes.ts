import { FastifyInstance, FastifyRequest } from 'fastify';
import { RequestContext, ValidationError, ForbiddenError } from '@general-erp/core';
import { productService } from '../modules/commercial/product.service.js';
import { customerService } from '../modules/commercial/customer.service.js';
import { supplierService } from '../modules/commercial/supplier.service.js';
import { addressService } from '../modules/commercial/address.service.js';
import { contactService } from '../modules/commercial/contact.service.js';
import { uomService } from '../modules/commercial/uom.service.js';
import { pricingService } from '../modules/commercial/pricing.service.js';
import { commercialImportService } from '../modules/commercial/commercial-import.service.js';

function getRequestContext(req: FastifyRequest): RequestContext {
  const tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
  const companyId = (req.headers['x-company-id'] as string) || 'company_default';

  const userId = req.headers['x-user-id'] as string | undefined;
  const roles = (req.headers['x-user-roles'] as string)?.split(',') || ['commercial_user'];
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

function validateCompanyScope(ctx: RequestContext, companyId?: string): void {
  if (companyId && ctx.companyId && companyId !== ctx.companyId && ctx.companyId !== 'company_default') {
    throw new ForbiddenError(`Company scope mismatch: Context company '${ctx.companyId}' cannot access requested company '${companyId}'.`);
  }
}

export async function commercialRoutes(fastify: FastifyInstance) {

  // ==========================================
  // 1. PRODUCTS
  // ==========================================

  fastify.post('/api/v1/commercial/products', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    if (!body) throw new ValidationError('Request body is required.');

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const product = await productService.createProduct(ctx, { ...body, companyId });
    return reply.status(201).send({ data: product });
  });

  fastify.get('/api/v1/commercial/products/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const product = await productService.getProduct(ctx, id);
    validateCompanyScope(ctx, product.companyId);

    return reply.send({ data: product });
  });

  fastify.patch('/api/v1/commercial/products/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const updated = await productService.updateProduct(ctx, id, body);
    return reply.send({ data: updated });
  });

  fastify.get('/api/v1/commercial/products', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      search?: string;
      category?: string;
      productType?: string;
      isActive?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const offset = (page - 1) * limit;

    const result = await productService.listProducts(ctx, {
      companyId,
      ...(query.search ? { search: query.search } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.productType ? { productType: query.productType } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      limit,
      offset
    });

    return reply.send({
      data: result.items,
      meta: {
        page,
        limit,
        total: result.total
      }
    });
  });

  // ==========================================
  // 2. CUSTOMERS
  // ==========================================

  fastify.post('/api/v1/commercial/customers', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    if (!body) throw new ValidationError('Request body is required.');

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const customer = await customerService.createCustomer(ctx, { ...body, companyId });
    return reply.status(201).send({ data: customer });
  });

  fastify.get('/api/v1/commercial/customers/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const customer = await customerService.getCustomer(ctx, id);
    validateCompanyScope(ctx, customer.companyId);

    return reply.send({ data: customer });
  });

  fastify.patch('/api/v1/commercial/customers/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const updated = await customerService.updateCustomer(ctx, id, body);
    return reply.send({ data: updated });
  });

  fastify.get('/api/v1/commercial/customers', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      search?: string;
      gstType?: string;
      isActive?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const offset = (page - 1) * limit;

    const result = await customerService.listCustomers(ctx, {
      companyId,
      ...(query.search ? { search: query.search } : {}),
      ...(query.gstType ? { gstType: query.gstType } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      limit,
      offset
    });

    return reply.send({
      data: result.items,
      meta: {
        page,
        limit,
        total: result.total
      }
    });
  });

  // ==========================================
  // 3. SUPPLIERS
  // ==========================================

  fastify.post('/api/v1/commercial/suppliers', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    if (!body) throw new ValidationError('Request body is required.');

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const supplier = await supplierService.createSupplier(ctx, { ...body, companyId });
    return reply.status(201).send({ data: supplier });
  });

  fastify.get('/api/v1/commercial/suppliers/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const supplier = await supplierService.getSupplier(ctx, id);
    validateCompanyScope(ctx, supplier.companyId);

    return reply.send({ data: supplier });
  });

  fastify.patch('/api/v1/commercial/suppliers/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const updated = await supplierService.updateSupplier(ctx, id, body);
    return reply.send({ data: updated });
  });

  fastify.get('/api/v1/commercial/suppliers', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as {
      companyId?: string;
      search?: string;
      msmeType?: string;
      isActive?: string;
      page?: string;
      limit?: string;
    };

    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const offset = (page - 1) * limit;

    const result = await supplierService.listSuppliers(ctx, {
      companyId,
      ...(query.search ? { search: query.search } : {}),
      ...(query.msmeType ? { msmeType: query.msmeType } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      limit,
      offset
    });

    return reply.send({
      data: result.items,
      meta: {
        page,
        limit,
        total: result.total
      }
    });
  });

  // ==========================================
  // 4. ADDRESSES
  // ==========================================

  fastify.post('/api/v1/commercial/addresses', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    if (!body) throw new ValidationError('Request body is required.');

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const address = await addressService.createAddress(ctx, { ...body, companyId });
    return reply.status(201).send({ data: address });
  });

  fastify.get('/api/v1/commercial/addresses/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const address = await addressService.getAddress(ctx, id);
    validateCompanyScope(ctx, address.companyId);

    return reply.send({ data: address });
  });

  fastify.get('/api/v1/commercial/addresses', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { customerId?: string; supplierId?: string; branchId?: string };

    const addresses = await addressService.listAddressesForParent(ctx, query);
    return reply.send({ data: addresses });
  });

  fastify.delete('/api/v1/commercial/addresses/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    await addressService.deleteAddress(ctx, id);
    return reply.send({ success: true });
  });

  // ==========================================
  // 5. CONTACTS
  // ==========================================

  fastify.post('/api/v1/commercial/contacts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    if (!body) throw new ValidationError('Request body is required.');

    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const contact = await contactService.createContact(ctx, { ...body, companyId });
    return reply.status(201).send({ data: contact });
  });

  fastify.get('/api/v1/commercial/contacts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    const contact = await contactService.getContact(ctx, id);
    validateCompanyScope(ctx, contact.companyId);

    return reply.send({ data: contact });
  });

  fastify.get('/api/v1/commercial/contacts', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { customerId?: string; supplierId?: string; branchId?: string };

    const contacts = await contactService.listContactsForParent(ctx, query);
    return reply.send({ data: contacts });
  });

  fastify.delete('/api/v1/commercial/contacts/:id', async (req, reply) => {
    const ctx = getRequestContext(req);
    const { id } = req.params as { id: string };

    await contactService.deleteContact(ctx, id);
    return reply.send({ success: true });
  });

  // ==========================================
  // 6. UOM & CONVERSIONS
  // ==========================================

  fastify.post('/api/v1/commercial/uom', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const uom = await uomService.createUom(ctx, { ...body, companyId });
    return reply.status(201).send({ data: uom });
  });

  fastify.get('/api/v1/commercial/uom', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string };
    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const uoms = await uomService.listUoms(ctx, companyId);
    return reply.send({ data: uoms });
  });

  fastify.post('/api/v1/commercial/uom/conversions', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const conv = await uomService.createConversion(ctx, { ...body, companyId });
    return reply.status(201).send({ data: conv });
  });

  fastify.post('/api/v1/commercial/uom/convert', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; fromUom: string; toUom: string; quantity: number | string };
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const res = await uomService.convertQuantity(ctx, companyId, body.fromUom, body.toUom, body.quantity);
    return reply.send({ data: res });
  });

  // ==========================================
  // 7. PRICING
  // ==========================================

  fastify.post('/api/v1/commercial/pricing/lists', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const list = await pricingService.createPricingList(ctx, { ...body, companyId });
    return reply.status(201).send({ data: list });
  });

  fastify.get('/api/v1/commercial/pricing/lists', async (req, reply) => {
    const ctx = getRequestContext(req);
    const query = req.query as { companyId?: string };
    const companyId = query.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const lists = await pricingService.listPricingLists(ctx, companyId);
    return reply.send({ data: lists });
  });

  fastify.post('/api/v1/commercial/pricing/rules', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const rule = await pricingService.createPricingRule(ctx, { ...body, companyId });
    return reply.status(201).send({ data: rule });
  });

  fastify.post('/api/v1/commercial/pricing/resolve', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as any;
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const result = await pricingService.resolvePrice(ctx, { ...body, companyId });
    return reply.send({ data: result });
  });

  // ==========================================
  // 8. COMMERCIAL MASTER DATA BULK IMPORT
  // ==========================================

  fastify.post('/api/v1/commercial/import/products', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; items: any[] };
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const idempotencyKey = (req.headers['idempotency-key'] as string);
    const result = await commercialImportService.importProducts(ctx, companyId, body.items, idempotencyKey);
    return reply.send({ data: result });
  });

  fastify.post('/api/v1/commercial/import/customers', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; items: any[] };
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const idempotencyKey = (req.headers['idempotency-key'] as string);
    const result = await commercialImportService.importCustomers(ctx, companyId, body.items, idempotencyKey);
    return reply.send({ data: result });
  });

  fastify.post('/api/v1/commercial/import/suppliers', async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = req.body as { companyId?: string; items: any[] };
    const companyId = body.companyId || ctx.companyId!;
    validateCompanyScope(ctx, companyId);

    const idempotencyKey = (req.headers['idempotency-key'] as string);
    const result = await commercialImportService.importSuppliers(ctx, companyId, body.items, idempotencyKey);
    return reply.send({ data: result });
  });

}
