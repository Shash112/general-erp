import { describe, it, expect, beforeEach } from 'vitest';
import { RequestContext } from '@general-erp/core';
import { productService } from '../src/modules/commercial/product.service.js';
import { customerService } from '../src/modules/commercial/customer.service.js';
import { supplierService } from '../src/modules/commercial/supplier.service.js';
import { addressService } from '../src/modules/commercial/address.service.js';
import { contactService } from '../src/modules/commercial/contact.service.js';
import { uomService } from '../src/modules/commercial/uom.service.js';
import { pricingService } from '../src/modules/commercial/pricing.service.js';
import { commercialImportService, MAX_BULK_IMPORT_BATCH_SIZE } from '../src/modules/commercial/commercial-import.service.js';
import { products, customers, suppliers, commercialAddresses, commercialContacts, uomDefinitions, uomConversions, pricingLists, pricingRules, pricingQuantityTiers } from '@general-erp/database';
import { getTableConfig } from 'drizzle-orm/pg-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 3.0 — Shared Commercial Foundation Integration Suite', () => {

  const ctxCompanyA: RequestContext = {
    requestId: 'req_test_001',
    tenantId: 'tenant_test',
    companyId: 'cmp_company_a',
    ip: '127.0.0.1',
    userAgent: 'test-runner',
    timestamp: new Date()
  };

  const ctxCompanyB: RequestContext = {
    requestId: 'req_test_002',
    tenantId: 'tenant_test',
    companyId: 'cmp_company_b',
    ip: '127.0.0.1',
    userAgent: 'test-runner',
    timestamp: new Date()
  };

  beforeEach(() => {
    productService.clear();
    customerService.clear();
    supplierService.clear();
    addressService.clear();
    contactService.clear();
    uomService.clear();
    pricingService.clear();
  });

  // =========================================================================
  // 1. Drizzle Schema & Migration 010 Verification
  // =========================================================================
  describe('1. Schema & Migration 010 Verification', () => {
    it('verifies commercial_addresses table config and 1-parent CHECK constraint', () => {
      const config = getTableConfig(commercialAddresses);
      const colsByName = Object.fromEntries(config.columns.map(c => [c.name, c]));

      expect(colsByName.id.getSQLType()).toContain('uuid');
      expect(colsByName.tenant_id.getSQLType()).toContain('varchar');
      expect(colsByName.company_id.getSQLType()).toContain('uuid');
      expect(colsByName.customer_id).toBeDefined();
      expect(colsByName.supplier_id).toBeDefined();
      expect(colsByName.branch_id).toBeDefined();
      expect(colsByName.state_code.getSQLType()).toContain('varchar');

      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_comm_addr_one_parent');
    });

    it('verifies commercial_contacts table config and 1-parent CHECK constraint', () => {
      const config = getTableConfig(commercialContacts);
      const checkNames = config.checks.map(chk => chk.name);
      expect(checkNames).toContain('chk_comm_cont_one_parent');
    });

    it('verifies uom_conversions precision and unique pair index', () => {
      const config = getTableConfig(uomConversions);
      const colsByName = Object.fromEntries(config.columns.map(c => [c.name, c]));
      expect(colsByName.conversion_factor.getSQLType()).toContain('numeric');

      const indexNames = config.indexes.map(idx => idx.config.name);
      expect(indexNames).toContain('idx_uom_conv_tenant_comp_pair');
    });

    it('verifies Migration file 010_phase3_0_commercial_foundation.sql exists', () => {
      const migrationPath = path.resolve(__dirname, '../../../packages/database/migrations/010_phase3_0_commercial_foundation.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);

      const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS "commercial_addresses"');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS "commercial_contacts"');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS "uom_definitions"');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS "uom_conversions"');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS "pricing_lists"');
      expect(sqlContent).toContain('chk_comm_addr_one_parent');
      expect(sqlContent).toContain('chk_comm_cont_one_parent');
    });
  });

  // =========================================================================
  // 2. Product Master Service
  // =========================================================================
  describe('2. Product Master Service', () => {
    it('creates product and enforces code & SKU uniqueness per company', async () => {
      const prod = await productService.createProduct(ctxCompanyA, {
        companyId: 'cmp_company_a',
        name: 'Precision Bearing 6205',
        code: 'BEAR-6205',
        sku: 'SKU-BEAR-6205',
        purchasePrice: '850.50',
        sellingPrice: '1200.00',
        baseUom: 'PCS'
      });

      expect(prod.id).toBeDefined();
      expect(prod.code).toBe('BEAR-6205');
      expect(prod.sku).toBe('SKU-BEAR-6205');
      expect(prod.purchasePrice).toBe('850.50');
      expect(prod.sellingPrice).toBe('1200.00');

      // Duplicate code in same company must fail
      await expect(
        productService.createProduct(ctxCompanyA, {
          companyId: 'cmp_company_a',
          name: 'Duplicate Bearing',
          code: 'BEAR-6205',
          sku: 'SKU-BEAR-DIFFERENT'
        })
      ).rejects.toThrow('already exists');

      // Same code in different company MUST succeed (tenant/company isolation)
      const prodB = await productService.createProduct(ctxCompanyB, {
        companyId: 'cmp_company_b',
        name: 'Bearing Company B',
        code: 'BEAR-6205',
        sku: 'SKU-BEAR-6205'
      });
      expect(prodB.companyId).toBe('cmp_company_b');
    });

    it('rejects negative product prices', async () => {
      await expect(
        productService.createProduct(ctxCompanyA, {
          companyId: 'cmp_company_a',
          name: 'Invalid Price Product',
          code: 'PROD-NEG',
          sku: 'SKU-NEG',
          sellingPrice: '-10.00'
        })
      ).rejects.toThrow('cannot be negative');
    });
  });

  // =========================================================================
  // 3. Customer Master Service
  // =========================================================================
  describe('3. Customer Master Service', () => {
    it('creates customer and validates GSTIN format', async () => {
      const cust = await customerService.createCustomer(ctxCompanyA, {
        companyId: 'cmp_company_a',
        name: 'Tata Steel Corp',
        code: 'CUST-TATA',
        gstin: '27AAAAA0000A1Z5',
        pan: 'AAAAA0000A',
        creditLimit: '500000.00',
        creditDays: 30
      });

      expect(cust.id).toBeDefined();
      expect(cust.code).toBe('CUST-TATA');
      expect(cust.gstin).toBe('27AAAAA0000A1Z5');
      expect(cust.creditLimit).toBe('500000.00');
      expect(cust.creditDays).toBe(30);
    });

    it('rejects invalid GSTIN format', async () => {
      await expect(
        customerService.createCustomer(ctxCompanyA, {
          companyId: 'cmp_company_a',
          name: 'Bad GSTIN Cust',
          code: 'CUST-BAD-GST',
          gstin: 'INVALID_GSTIN_123'
        })
      ).rejects.toThrow('GSTIN is invalid');
    });
  });

  // =========================================================================
  // 4. Supplier Master Service
  // =========================================================================
  describe('4. Supplier Master Service', () => {
    it('creates supplier with MSME and TDS metadata', async () => {
      const sup = await supplierService.createSupplier(ctxCompanyA, {
        companyId: 'cmp_company_a',
        name: 'Reliance Logistics Suppliers',
        code: 'SUP-RELIANCE',
        gstin: '27BBBBB1111B1Z2',
        msmeType: 'SMALL',
        msmeRegNo: 'MSME-2026-99',
        tdsSection: '194C'
      });

      expect(sup.id).toBeDefined();
      expect(sup.msmeType).toBe('SMALL');
      expect(sup.msmeRegNo).toBe('MSME-2026-99');
      expect(sup.tdsSection).toBe('194C');
    });
  });

  // =========================================================================
  // 5. Commercial Addresses & Contacts (1-Parent Constraint)
  // =========================================================================
  describe('5. Addresses & Contacts 1-Parent Constraint', () => {
    it('creates address attached to Customer and validates state code', async () => {
      const cust = await customerService.createCustomer(ctxCompanyA, {
        companyId: 'cmp_company_a',
        name: 'Address Test Customer',
        code: 'CUST-ADDR'
      });

      const addr = await addressService.createAddress(ctxCompanyA, {
        companyId: 'cmp_company_a',
        customerId: cust.id,
        addressType: 'BILLING',
        addressLine1: '100 Industrial Parkway',
        city: 'Mumbai',
        state: 'Maharashtra',
        stateCode: '27',
        postalCode: '400001'
      });

      expect(addr.id).toBeDefined();
      expect(addr.customerId).toBe(cust.id);
      expect(addr.stateCode).toBe('27');
    });

    it('rejects address creation without exactly one parent', async () => {
      // 0 parents -> fail
      await expect(
        addressService.createAddress(ctxCompanyA, {
          companyId: 'cmp_company_a',
          addressLine1: 'No Parent',
          city: 'Delhi',
          state: 'Delhi',
          stateCode: '07',
          postalCode: '110001'
        })
      ).rejects.toThrow('exactly one parent');

      // 2 parents -> fail
      await expect(
        addressService.createAddress(ctxCompanyA, {
          companyId: 'cmp_company_a',
          customerId: 'cust_dummy_1',
          supplierId: 'sup_dummy_1',
          addressLine1: 'Dual Parent',
          city: 'Delhi',
          state: 'Delhi',
          stateCode: '07',
          postalCode: '110001'
        })
      ).rejects.toThrow('exactly one parent');
    });

    it('creates contact attached to Supplier with 1-parent constraint', async () => {
      const sup = await supplierService.createSupplier(ctxCompanyA, {
        companyId: 'cmp_company_a',
        name: 'Contact Supplier',
        code: 'SUP-CONT'
      });

      const cont = await contactService.createContact(ctxCompanyA, {
        companyId: 'cmp_company_a',
        supplierId: sup.id,
        name: 'John Doe',
        designation: 'Procurement Officer',
        email: 'john@supplier.com',
        isPrimary: true
      });

      expect(cont.id).toBeDefined();
      expect(cont.supplierId).toBe(sup.id);
      expect(cont.isPrimary).toBe(true);
    });
  });

  // =========================================================================
  // 6. UOM & Conversion Factor Calculations
  // =========================================================================
  describe('6. UOM & Conversions', () => {
    it('creates UOM definitions and exact decimal conversion factors', async () => {
      const pcs = await uomService.createUom(ctxCompanyA, {
        companyId: 'cmp_company_a',
        code: 'PCS',
        name: 'Pieces',
        symbol: 'pcs'
      });

      const box = await uomService.createUom(ctxCompanyA, {
        companyId: 'cmp_company_a',
        code: 'BOX',
        name: 'Box of 12',
        symbol: 'box'
      });

      const conv = await uomService.createConversion(ctxCompanyA, {
        companyId: 'cmp_company_a',
        fromUom: 'BOX',
        toUom: 'PCS',
        conversionFactor: '12.000000'
      });

      expect(conv.conversionFactor).toBe('12.000000');

      // Forward conversion (2 BOX -> 24 PCS)
      const fwd = await uomService.convertQuantity(ctxCompanyA, 'cmp_company_a', 'BOX', 'PCS', '2.0000');
      expect(fwd.convertedQuantity).toBe('24.000000');

      // Reverse conversion (24 PCS -> 2 BOX)
      const rev = await uomService.convertQuantity(ctxCompanyA, 'cmp_company_a', 'PCS', 'BOX', '24.0000');
      expect(rev.convertedQuantity).toBe('2.000000');
    });

    it('rejects duplicate or invalid self conversions', async () => {
      await expect(
        uomService.createConversion(ctxCompanyA, {
          companyId: 'cmp_company_a',
          fromUom: 'PCS',
          toUom: 'PCS',
          conversionFactor: '1.000000'
        })
      ).rejects.toThrow('cannot be identical');
    });
  });

  // =========================================================================
  // 7. Commercial Pricing Engine & Resolution Cascade
  // =========================================================================
  describe('7. Pricing Engine & Resolution Cascade', () => {
    it('executes pricing cascade: Entity Override -> Price List -> Product Default', async () => {
      const prod = await productService.createProduct(ctxCompanyA, {
        companyId: 'cmp_company_a',
        name: 'Valve Component',
        code: 'VALVE-01',
        sku: 'SKU-VALVE',
        sellingPrice: '500.00'
      });

      const cust = await customerService.createCustomer(ctxCompanyA, {
        companyId: 'cmp_company_a',
        name: 'VIP Client',
        code: 'CUST-VIP'
      });

      const plist = await pricingService.createPricingList(ctxCompanyA, {
        companyId: 'cmp_company_a',
        code: 'PLIST-WHOLESALE',
        name: 'Wholesale Price List',
        effectiveFrom: '2026-01-01'
      });

      // Price List Rule (Price List price = $450.00)
      await pricingService.createPricingRule(ctxCompanyA, {
        companyId: 'cmp_company_a',
        pricingListId: plist.id,
        productId: prod.id,
        unitPrice: '450.00',
        effectiveFrom: '2026-01-01'
      });

      // Entity-specific override (VIP Client price = $400.00)
      await pricingService.createPricingRule(ctxCompanyA, {
        companyId: 'cmp_company_a',
        productId: prod.id,
        customerId: cust.id,
        unitPrice: '400.00',
        effectiveFrom: '2026-01-01'
      });

      // Resolve 1: Generic customer -> falls back to Price List ($450.00)
      const resList = await pricingService.resolvePrice(ctxCompanyA, {
        companyId: 'cmp_company_a',
        productId: prod.id,
        quantity: 1,
        effectiveDate: '2026-06-01'
      });
      expect(resList.source).toBe('PRICE_LIST');
      expect(resList.unitPrice).toBe('450.00');

      // Resolve 2: VIP customer -> Entity Override ($400.00)
      const resEntity = await pricingService.resolvePrice(ctxCompanyA, {
        companyId: 'cmp_company_a',
        productId: prod.id,
        customerId: cust.id,
        quantity: 1,
        effectiveDate: '2026-06-01'
      });
      expect(resEntity.source).toBe('ENTITY_OVERRIDE');
      expect(resEntity.unitPrice).toBe('400.00');
    });
  });

  // =========================================================================
  // 8. Commercial Master Data Bulk Import (ADR-307 — DECIDED)
  // =========================================================================
  describe('8. Commercial Master Data Bulk Import (ADR-307)', () => {
    it('enforces maximum 500 records batch limit', async () => {
      const items = Array.from({ length: 501 }, (_, i) => ({
        companyId: 'cmp_company_a',
        name: `Product ${i}`,
        code: `P-${i}`,
        sku: `SKU-${i}`
      }));

      await expect(
        commercialImportService.importProducts(ctxCompanyA, 'cmp_company_a', items)
      ).rejects.toThrow(`exceeds maximum limit of ${MAX_BULK_IMPORT_BATCH_SIZE}`);
    });

    it('rejects in-batch duplicates and database duplicates without partial insertion (Atomic Rollback)', async () => {
      const batchWithDuplicates = [
        { companyId: 'cmp_company_a', name: 'Prod A', code: 'P-DUP', sku: 'SKU-A' },
        { companyId: 'cmp_company_a', name: 'Prod B', code: 'P-DUP', sku: 'SKU-B' } // Duplicate code
      ];

      await expect(
        commercialImportService.importProducts(ctxCompanyA, 'cmp_company_a', batchWithDuplicates)
      ).rejects.toThrow('validation failed');

      // Verify ZERO records persisted from failed batch
      const list = await productService.listProducts(ctxCompanyA, { companyId: 'cmp_company_a' });
      expect(list.total).toBe(0);
    });

    it('supports idempotent import submission via Idempotency-Key', async () => {
      const batch = [
        { companyId: 'cmp_company_a', name: 'Import Prod 1', code: 'IMP-01', sku: 'SKU-IMP-01' },
        { companyId: 'cmp_company_a', name: 'Import Prod 2', code: 'IMP-02', sku: 'SKU-IMP-02' }
      ];

      const key = 'idem_import_key_999';

      const res1 = await commercialImportService.importProducts(ctxCompanyA, 'cmp_company_a', batch, key);
      expect(res1.success).toBe(true);
      expect(res1.importedCount).toBe(2);

      // Duplicate submission with same key returns cached result without throwing duplicate conflict
      const res2 = await commercialImportService.importProducts(ctxCompanyA, 'cmp_company_a', batch, key);
      expect(res2.success).toBe(true);
      expect(res2.importedCount).toBe(2);
    });
  });

});
