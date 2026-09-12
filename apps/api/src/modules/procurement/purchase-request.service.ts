import {
  RequestContext,
  ExactDecimal,
  ValidationError,
  NotFoundError,
  BusinessRuleViolationError
} from '@general-erp/core';
import { authorizationService } from '../../platform/authorization/authorization.service.js';
import { auditService } from '../../platform/audit/audit.service.js';
import { numberingEngine } from '../../platform/numbering/numbering.service.js';
import {
  getDb,
  purchaseRequests,
  purchaseRequestLines,
  companies,
  eq,
  and,
  sql,
  or,
  ilike,
  PurchaseRequest,
  PurchaseRequestLine
} from '@general-erp/database';

export interface CreatePurchaseRequestLineInput {
  productId?: string | null;
  description: string;
  requestedQuantity: string;
  uom: string;
  estimatedUnitPrice?: string | null;
  estimatedDiscount?: string | null;
  estimatedTax?: string | null;
  requiredDate?: string | null;
  preferredSupplierId?: string | null;
  specification?: string | null;
  notes?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
}

export interface CreatePurchaseRequestInput {
  companyId: string;
  branchId?: string | null;
  departmentId?: string | null;
  requestDate?: string;
  requiredDate: string;
  requesterEmployeeId?: string | null;
  purpose?: string | null;
  justification?: string | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  preferredSupplierId?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
  currency?: string;
  notes?: string | null;
  lines: CreatePurchaseRequestLineInput[];
}

export interface UpdatePurchaseRequestInput {
  branchId?: string | null;
  departmentId?: string | null;
  requiredDate?: string;
  requesterEmployeeId?: string | null;
  purpose?: string | null;
  justification?: string | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  preferredSupplierId?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
  currency?: string;
  notes?: string | null;
  lines?: CreatePurchaseRequestLineInput[];
  version?: number;
}

export interface PurchaseRequestLineDTO {
  id: string;
  purchaseRequestId: string;
  lineNumber: number;
  productId?: string | null;
  description: string;
  requestedQuantity: string;
  orderedQuantity: string;
  remainingQuantity: string;
  uom: string;
  estimatedUnitPrice: string;
  estimatedDiscount: string;
  estimatedTax: string;
  estimatedLineTotal: string;
  requiredDate?: string | null;
  preferredSupplierId?: string | null;
  specification?: string | null;
  notes?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseRequestDTO {
  id: string;
  tenantId: string;
  companyId: string;
  branchId?: string | null;
  departmentId?: string | null;
  requestNumber: string;
  requestDate: string;
  requiredDate: string;
  requesterUserId: string;
  requesterEmployeeId?: string | null;
  purpose?: string | null;
  justification?: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ORDERED';
  preferredSupplierId?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
  currency: string;
  estimatedTotal: string;
  notes?: string | null;
  submittedAt?: Date | null;
  submittedBy?: string | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  rejectedAt?: Date | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  lines: PurchaseRequestLineDTO[];
}

export interface ListPurchaseRequestsFilter {
  companyId: string;
  status?: string;
  departmentId?: string;
  requesterUserId?: string;
  priority?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

const formatDecimal2 = (raw: string | number): string => {
  const val = typeof raw === 'number' ? raw.toString() : (raw || '0');
  const parsed = ExactDecimal.parse(val, 4);
  return ExactDecimal.halfEvenRound(parsed.rawBigInt, 4, 2).toString();
};

const formatDecimal4 = (raw: string | number): string => {
  const val = typeof raw === 'number' ? raw.toString() : (raw || '0');
  const parsed = ExactDecimal.parse(val, 4);
  return parsed.toString();
};

function extractActorId(ctx: RequestContext): string {
  return ctx.user?.userId || (ctx as any).userId || 'system';
}

export class PurchaseRequestService {
  private memoryStore = new Map<string, PurchaseRequestDTO>();
  private idempotencyStore = new Map<string, PurchaseRequestDTO>();
  private inFlightLocks = new Map<string, Promise<void>>();

  public clearMemoryStores(): void {
    this.memoryStore.clear();
    this.idempotencyStore.clear();
    this.inFlightLocks.clear();
  }

  private checkPermission(ctx: RequestContext, action: string): void {
    if (ctx.user) {
      const isWildcard = ctx.user.permissions.some(p => p === '*' || p === action || p.startsWith('procurement:'));
      if (!isWildcard) {
        authorizationService.authorize({ user: ctx.user, action, companyId: ctx.companyId });
      }
    }
  }

  /**
   * Create a new draft Purchase Request
   */
  async createPurchaseRequest(ctx: RequestContext, input: CreatePurchaseRequestInput): Promise<PurchaseRequestDTO> {
    this.checkPermission(ctx, 'procurement:request:create');

    if (!input.lines || input.lines.length === 0) {
      throw new ValidationError('Purchase request must contain at least one line item');
    }

    const todayStr = new Date().toISOString().split('T')[0] || '';
    const reqDate = input.requestDate || todayStr;
    const requiredDate = input.requiredDate;

    if (requiredDate < reqDate && input.priority !== 'URGENT') {
      throw new ValidationError('Required date cannot be earlier than request date unless priority is URGENT');
    }

    const actorId = extractActorId(ctx);

    // Process lines using ExactDecimal
    let totalEstimatedAmount = ExactDecimal.parse('0', 2);
    const calculatedLines: PurchaseRequestLineDTO[] = [];
    const prId = `pr_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      if (!line) continue;

      const requestedQtyDec = ExactDecimal.parse(line.requestedQuantity, 4);
      if (requestedQtyDec.isZero() || requestedQtyDec.isNegative()) {
        throw new ValidationError(`Line ${i + 1}: Requested quantity must be greater than zero`);
      }

      const unitPriceDec = ExactDecimal.parse(line.estimatedUnitPrice || '0', 2);
      const discountDec = ExactDecimal.parse(line.estimatedDiscount || '0', 2);
      const taxDec = ExactDecimal.parse(line.estimatedTax || '0', 2);

      const unroundedGross = requestedQtyDec.rawBigInt * unitPriceDec.rawBigInt;
      const grossLine = ExactDecimal.halfEvenRound(unroundedGross, 6, 2);
      const lineTotalDec = grossLine.sub(discountDec).add(taxDec);

      totalEstimatedAmount = totalEstimatedAmount.add(lineTotalDec);

      calculatedLines.push({
        id: `prl_${Date.now()}_${i + 1}`,
        purchaseRequestId: prId,
        lineNumber: i + 1,
        productId: line.productId || null,
        description: line.description,
        requestedQuantity: formatDecimal4(line.requestedQuantity),
        orderedQuantity: '0.0000',
        remainingQuantity: formatDecimal4(line.requestedQuantity),
        uom: line.uom,
        estimatedUnitPrice: formatDecimal2(line.estimatedUnitPrice || '0'),
        estimatedDiscount: formatDecimal2(line.estimatedDiscount || '0'),
        estimatedTax: formatDecimal2(line.estimatedTax || '0'),
        estimatedLineTotal: lineTotalDec.toString(),
        requiredDate: line.requiredDate || requiredDate,
        preferredSupplierId: line.preferredSupplierId || input.preferredSupplierId || null,
        specification: line.specification || null,
        notes: line.notes || null,
        projectId: line.projectId || input.projectId || null,
        costCenterId: line.costCenterId || input.costCenterId || null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    let requestNumber = '';
    try {
      requestNumber = numberingEngine.generateNextNumber(
        ctx.tenantId,
        input.companyId,
        'PURCHASE_REQUEST',
        new Date().getFullYear().toString()
      );
    } catch {
      const year = new Date().getFullYear();
      const rand = Math.floor(1000 + Math.random() * 9000);
      requestNumber = `PR-${year}-${rand}`;
    }

    const db = getDb();
    if (db) {
      // Validate company existence
      const [company] = await db.select().from(companies).where(
        and(eq(companies.id, input.companyId), eq(companies.tenantId, ctx.tenantId))
      );
      if (!company) {
        throw new NotFoundError(`Company with ID ${input.companyId} not found`);
      }

      const result = await db.transaction(async (tx) => {
        const [header] = await tx.insert(purchaseRequests).values({
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          branchId: input.branchId || null,
          departmentId: input.departmentId || null,
          requestNumber,
          requestDate: reqDate,
          requiredDate,
          requesterUserId: actorId,
          requesterEmployeeId: input.requesterEmployeeId || null,
          purpose: input.purpose || null,
          justification: input.justification || null,
          priority: input.priority || 'NORMAL',
          status: 'DRAFT',
          preferredSupplierId: input.preferredSupplierId || null,
          projectId: input.projectId || null,
          costCenterId: input.costCenterId || null,
          currency: input.currency || 'INR',
          estimatedTotal: totalEstimatedAmount.toString(),
          notes: input.notes || null,
          version: 1,
          createdBy: actorId,
          updatedBy: actorId,
        }).returning();

        if (!header) {
          throw new BusinessRuleViolationError('Failed to insert purchase request header');
        }

        const insertedLines = [];
        for (const lineVal of calculatedLines) {
          const [insertedLine] = await tx.insert(purchaseRequestLines).values({
            purchaseRequestId: header.id,
            lineNumber: lineVal.lineNumber,
            productId: lineVal.productId || null,
            description: lineVal.description,
            requestedQuantity: lineVal.requestedQuantity,
            orderedQuantity: lineVal.orderedQuantity,
            remainingQuantity: lineVal.remainingQuantity,
            uom: lineVal.uom,
            estimatedUnitPrice: lineVal.estimatedUnitPrice,
            estimatedDiscount: lineVal.estimatedDiscount,
            estimatedTax: lineVal.estimatedTax,
            estimatedLineTotal: lineVal.estimatedLineTotal,
            requiredDate: lineVal.requiredDate || null,
            preferredSupplierId: lineVal.preferredSupplierId || null,
            specification: lineVal.specification || null,
            notes: lineVal.notes || null,
            projectId: lineVal.projectId || null,
            costCenterId: lineVal.costCenterId || null,
            version: 1,
          }).returning();
          if (insertedLine) {
            insertedLines.push(insertedLine);
          }
        }

        return this.mapToDTO(header, insertedLines);
      });

      await auditService.logEvent(ctx, {
        module: 'procurement',
        entityName: 'PurchaseRequest',
        entityId: result.id,
        action: 'CREATE',
        newValues: { requestNumber: result.requestNumber, status: result.status, estimatedTotal: result.estimatedTotal }
      });

      return result;
    }

    // In-Memory Mode
    const dto: PurchaseRequestDTO = {
      id: prId,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      departmentId: input.departmentId || null,
      requestNumber,
      requestDate: reqDate,
      requiredDate,
      requesterUserId: actorId,
      requesterEmployeeId: input.requesterEmployeeId || null,
      purpose: input.purpose || null,
      justification: input.justification || null,
      priority: input.priority || 'NORMAL',
      status: 'DRAFT',
      preferredSupplierId: input.preferredSupplierId || null,
      projectId: input.projectId || null,
      costCenterId: input.costCenterId || null,
      currency: input.currency || 'INR',
      estimatedTotal: totalEstimatedAmount.toString(),
      notes: input.notes || null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: actorId,
      updatedBy: actorId,
      lines: calculatedLines
    };

    this.memoryStore.set(dto.id, dto);

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseRequest',
      entityId: dto.id,
      action: 'CREATE',
      newValues: { requestNumber: dto.requestNumber, status: dto.status, estimatedTotal: dto.estimatedTotal }
    });

    return dto;
  }

  /**
   * Update draft Purchase Request
   */
  async updatePurchaseRequest(ctx: RequestContext, id: string, input: UpdatePurchaseRequestInput): Promise<PurchaseRequestDTO> {
    this.checkPermission(ctx, 'procurement:request:update');

    const existing = await this.getPurchaseRequestById(ctx, id);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot update Purchase Request in status ${existing.status}`);
    }

    if (input.version !== undefined && input.version !== existing.version) {
      throw new BusinessRuleViolationError('Concurrency conflict: Purchase Request has been modified by another user');
    }

    const actorId = extractActorId(ctx);
    let updatedLines = existing.lines;
    let estimatedTotal = ExactDecimal.parse(existing.estimatedTotal, 2);

    if (input.lines && input.lines.length > 0) {
      let totalDec = ExactDecimal.parse('0', 2);
      const newLines: PurchaseRequestLineDTO[] = [];

      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        if (!line) continue;

        const qtyDec = ExactDecimal.parse(line.requestedQuantity, 4);
        if (qtyDec.isZero() || qtyDec.isNegative()) {
          throw new ValidationError(`Line ${i + 1}: Requested quantity must be greater than zero`);
        }

        const unitPriceDec = ExactDecimal.parse(line.estimatedUnitPrice || '0', 2);
        const discountDec = ExactDecimal.parse(line.estimatedDiscount || '0', 2);
        const taxDec = ExactDecimal.parse(line.estimatedTax || '0', 2);

        const unroundedGross = qtyDec.rawBigInt * unitPriceDec.rawBigInt;
        const grossLine = ExactDecimal.halfEvenRound(unroundedGross, 6, 2);
        const lineTotalDec = grossLine.sub(discountDec).add(taxDec);
        totalDec = totalDec.add(lineTotalDec);

        newLines.push({
          id: `prl_${Date.now()}_${i + 1}`,
          purchaseRequestId: id,
          lineNumber: i + 1,
          productId: line.productId || null,
          description: line.description,
          requestedQuantity: formatDecimal4(line.requestedQuantity),
          orderedQuantity: '0.0000',
          remainingQuantity: formatDecimal4(line.requestedQuantity),
          uom: line.uom,
          estimatedUnitPrice: formatDecimal2(line.estimatedUnitPrice || '0'),
          estimatedDiscount: formatDecimal2(line.estimatedDiscount || '0'),
          estimatedTax: formatDecimal2(line.estimatedTax || '0'),
          estimatedLineTotal: lineTotalDec.toString(),
          requiredDate: line.requiredDate || input.requiredDate || existing.requiredDate,
          preferredSupplierId: line.preferredSupplierId || input.preferredSupplierId || null,
          specification: line.specification || null,
          notes: line.notes || null,
          projectId: line.projectId || input.projectId || null,
          costCenterId: line.costCenterId || input.costCenterId || null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      updatedLines = newLines;
      estimatedTotal = totalDec;
    }

    const db = getDb();
    if (db) {
      const updatedHeader = await db.transaction(async (tx) => {
        if (input.lines && input.lines.length > 0) {
          await tx.delete(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, id));
          for (const l of updatedLines) {
            await tx.insert(purchaseRequestLines).values({
              purchaseRequestId: id,
              lineNumber: l.lineNumber,
              productId: l.productId || null,
              description: l.description,
              requestedQuantity: l.requestedQuantity,
              orderedQuantity: l.orderedQuantity,
              remainingQuantity: l.remainingQuantity,
              uom: l.uom,
              estimatedUnitPrice: l.estimatedUnitPrice,
              estimatedDiscount: l.estimatedDiscount,
              estimatedTax: l.estimatedTax,
              estimatedLineTotal: l.estimatedLineTotal,
              requiredDate: l.requiredDate || null,
              preferredSupplierId: l.preferredSupplierId || null,
              specification: l.specification || null,
              notes: l.notes || null,
              projectId: l.projectId || null,
              costCenterId: l.costCenterId || null,
              version: 1,
            });
          }
        }

        const updateSet: Record<string, any> = {
          version: existing.version + 1,
          updatedAt: new Date(),
          updatedBy: actorId,
        };

        if (input.branchId !== undefined) updateSet.branchId = input.branchId;
        if (input.departmentId !== undefined) updateSet.departmentId = input.departmentId;
        if (input.requiredDate !== undefined) updateSet.requiredDate = input.requiredDate;
        if (input.requesterEmployeeId !== undefined) updateSet.requesterEmployeeId = input.requesterEmployeeId;
        if (input.purpose !== undefined) updateSet.purpose = input.purpose;
        if (input.justification !== undefined) updateSet.justification = input.justification;
        if (input.priority !== undefined) updateSet.priority = input.priority;
        if (input.preferredSupplierId !== undefined) updateSet.preferredSupplierId = input.preferredSupplierId;
        if (input.projectId !== undefined) updateSet.projectId = input.projectId;
        if (input.costCenterId !== undefined) updateSet.costCenterId = input.costCenterId;
        if (input.currency !== undefined) updateSet.currency = input.currency;
        if (estimatedTotal !== undefined) updateSet.estimatedTotal = estimatedTotal.toString();
        if (input.notes !== undefined) updateSet.notes = input.notes;

        const [hdr] = await tx.update(purchaseRequests).set(updateSet).where(eq(purchaseRequests.id, id)).returning();
        if (!hdr) throw new BusinessRuleViolationError(`Failed to update Purchase Request '${id}'`);
        return hdr;
      });

      const lines = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, id));
      return this.mapToDTO(updatedHeader, lines);
    }

    // In-Memory Mode
    const updatedDTO: PurchaseRequestDTO = {
      ...existing,
      branchId: input.branchId !== undefined ? (input.branchId || null) : (existing.branchId || null),
      departmentId: input.departmentId !== undefined ? (input.departmentId || null) : (existing.departmentId || null),
      requiredDate: input.requiredDate !== undefined ? input.requiredDate : existing.requiredDate,
      requesterEmployeeId: input.requesterEmployeeId !== undefined ? (input.requesterEmployeeId || null) : (existing.requesterEmployeeId || null),
      purpose: input.purpose !== undefined ? (input.purpose || null) : (existing.purpose || null),
      justification: input.justification !== undefined ? (input.justification || null) : (existing.justification || null),
      priority: input.priority !== undefined ? input.priority : existing.priority,
      preferredSupplierId: input.preferredSupplierId !== undefined ? (input.preferredSupplierId || null) : (existing.preferredSupplierId || null),
      projectId: input.projectId !== undefined ? (input.projectId || null) : (existing.projectId || null),
      costCenterId: input.costCenterId !== undefined ? (input.costCenterId || null) : (existing.costCenterId || null),
      currency: input.currency !== undefined ? input.currency : existing.currency,
      estimatedTotal: estimatedTotal.toString(),
      notes: input.notes !== undefined ? (input.notes || null) : (existing.notes || null),
      version: existing.version + 1,
      updatedAt: new Date(),
      updatedBy: actorId,
      lines: updatedLines
    };

    this.memoryStore.set(id, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseRequest',
      entityId: id,
      action: 'UPDATE',
      newValues: { version: updatedDTO.version }
    });

    return updatedDTO;
  }

  /**
   * Submit Purchase Request
   */
  async submitPurchaseRequest(ctx: RequestContext, id: string): Promise<PurchaseRequestDTO> {
    this.checkPermission(ctx, 'procurement:request:submit');

    const existing = await this.getPurchaseRequestById(ctx, id);

    if (existing.status !== 'DRAFT') {
      throw new BusinessRuleViolationError(`Cannot submit Purchase Request in status ${existing.status}`);
    }

    if (existing.lines.length === 0) {
      throw new BusinessRuleViolationError('Cannot submit Purchase Request without lines');
    }

    const actorId = extractActorId(ctx);
    const db = getDb();
    if (db) {
      const [submitted] = await db.update(purchaseRequests).set({
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedBy: actorId,
        version: existing.version + 1,
        updatedAt: new Date(),
        updatedBy: actorId,
      }).where(eq(purchaseRequests.id, id)).returning();

      if (!submitted) throw new BusinessRuleViolationError(`Failed to submit Purchase Request '${id}'`);

      const lines = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, id));
      return this.mapToDTO(submitted, lines);
    }

    // In-Memory Mode
    const updatedDTO: PurchaseRequestDTO = {
      ...existing,
      status: 'SUBMITTED',
      submittedAt: new Date(),
      submittedBy: actorId,
      version: existing.version + 1,
      updatedAt: new Date(),
      updatedBy: actorId
    };

    this.memoryStore.set(id, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseRequest',
      entityId: id,
      action: 'SUBMIT',
      newValues: { status: 'SUBMITTED', submittedAt: updatedDTO.submittedAt }
    });

    return updatedDTO;
  }

  /**
   * Approve Purchase Request
   */
  async approvePurchaseRequest(ctx: RequestContext, id: string): Promise<PurchaseRequestDTO> {
    this.checkPermission(ctx, 'procurement:request:approve');

    const existing = await this.getPurchaseRequestById(ctx, id);

    if (existing.status !== 'SUBMITTED') {
      throw new BusinessRuleViolationError(`Cannot approve Purchase Request in status ${existing.status}`);
    }

    const actorId = extractActorId(ctx);
    const db = getDb();
    if (db) {
      const [approved] = await db.update(purchaseRequests).set({
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: actorId,
        version: existing.version + 1,
        updatedAt: new Date(),
        updatedBy: actorId,
      }).where(eq(purchaseRequests.id, id)).returning();

      if (!approved) throw new BusinessRuleViolationError(`Failed to approve Purchase Request '${id}'`);

      const lines = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, id));
      return this.mapToDTO(approved, lines);
    }

    // In-Memory Mode
    const updatedDTO: PurchaseRequestDTO = {
      ...existing,
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: actorId,
      version: existing.version + 1,
      updatedAt: new Date(),
      updatedBy: actorId
    };

    this.memoryStore.set(id, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseRequest',
      entityId: id,
      action: 'APPROVE',
      newValues: { status: 'APPROVED', approvedAt: updatedDTO.approvedAt }
    });

    return updatedDTO;
  }

  /**
   * Reject Purchase Request
   */
  async rejectPurchaseRequest(ctx: RequestContext, id: string, rejectionReason: string): Promise<PurchaseRequestDTO> {
    this.checkPermission(ctx, 'procurement:request:reject');

    if (!rejectionReason || !rejectionReason.trim()) {
      throw new ValidationError('Rejection reason is required');
    }

    const existing = await this.getPurchaseRequestById(ctx, id);

    if (existing.status !== 'SUBMITTED') {
      throw new BusinessRuleViolationError(`Cannot reject Purchase Request in status ${existing.status}`);
    }

    const actorId = extractActorId(ctx);
    const db = getDb();
    if (db) {
      const [rejected] = await db.update(purchaseRequests).set({
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectedBy: actorId,
        rejectionReason: rejectionReason.trim(),
        version: existing.version + 1,
        updatedAt: new Date(),
        updatedBy: actorId,
      }).where(eq(purchaseRequests.id, id)).returning();

      if (!rejected) throw new BusinessRuleViolationError(`Failed to reject Purchase Request '${id}'`);

      const lines = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, id));
      return this.mapToDTO(rejected, lines);
    }

    // In-Memory Mode
    const updatedDTO: PurchaseRequestDTO = {
      ...existing,
      status: 'REJECTED',
      rejectedAt: new Date(),
      rejectedBy: actorId,
      rejectionReason: rejectionReason.trim(),
      version: existing.version + 1,
      updatedAt: new Date(),
      updatedBy: actorId
    };

    this.memoryStore.set(id, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseRequest',
      entityId: id,
      action: 'REJECT',
      newValues: { status: 'REJECTED', rejectionReason: updatedDTO.rejectionReason }
    });

    return updatedDTO;
  }

  /**
   * Cancel Purchase Request
   */
  async cancelPurchaseRequest(ctx: RequestContext, id: string, cancellationReason: string): Promise<PurchaseRequestDTO> {
    this.checkPermission(ctx, 'procurement:request:cancel');

    if (!cancellationReason || !cancellationReason.trim()) {
      throw new ValidationError('Cancellation reason is required');
    }

    const existing = await this.getPurchaseRequestById(ctx, id);

    if (existing.status !== 'DRAFT' && existing.status !== 'SUBMITTED') {
      throw new BusinessRuleViolationError(`Cannot cancel Purchase Request in status ${existing.status}`);
    }

    const actorId = extractActorId(ctx);
    const db = getDb();
    if (db) {
      const [cancelled] = await db.update(purchaseRequests).set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: actorId,
        cancellationReason: cancellationReason.trim(),
        version: existing.version + 1,
        updatedAt: new Date(),
        updatedBy: actorId,
      }).where(eq(purchaseRequests.id, id)).returning();

      if (!cancelled) throw new BusinessRuleViolationError(`Failed to cancel Purchase Request '${id}'`);

      const lines = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, id));
      return this.mapToDTO(cancelled, lines);
    }

    // In-Memory Mode
    const updatedDTO: PurchaseRequestDTO = {
      ...existing,
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: actorId,
      cancellationReason: cancellationReason.trim(),
      version: existing.version + 1,
      updatedAt: new Date(),
      updatedBy: actorId
    };

    this.memoryStore.set(id, updatedDTO);

    await auditService.logEvent(ctx, {
      module: 'procurement',
      entityName: 'PurchaseRequest',
      entityId: id,
      action: 'CANCEL',
      newValues: { status: 'CANCELLED', cancellationReason: updatedDTO.cancellationReason }
    });

    return updatedDTO;
  }

  /**
   * Get Purchase Request by ID
   */
  async getPurchaseRequestById(ctx: RequestContext, id: string): Promise<PurchaseRequestDTO> {
    this.checkPermission(ctx, 'procurement:request:read');

    const db = getDb();
    if (db) {
      const headers = await db.select().from(purchaseRequests).where(
        and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, ctx.tenantId))
      );
      const header = headers[0];

      if (!header) {
        throw new NotFoundError(`Purchase Request with ID ${id} not found`);
      }

      const lines = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, id));
      return this.mapToDTO(header, lines);
    }

    // In-Memory Mode
    const found = this.memoryStore.get(id);
    if (!found || found.tenantId !== ctx.tenantId) {
      throw new NotFoundError(`Purchase Request with ID ${id} not found`);
    }

    return found;
  }

  /**
   * List Purchase Requests
   */
  async listPurchaseRequests(ctx: RequestContext, filter: ListPurchaseRequestsFilter): Promise<{ items: PurchaseRequestDTO[]; total: number }> {
    this.checkPermission(ctx, 'procurement:request:read');

    const db = getDb();
    if (db) {
      const page = filter.page || 1;
      const limit = filter.limit || 20;
      const offset = (page - 1) * limit;

      const conditions = [
        eq(purchaseRequests.tenantId, ctx.tenantId),
        eq(purchaseRequests.companyId, filter.companyId),
      ];

      if (filter.status) conditions.push(eq(purchaseRequests.status, filter.status));
      if (filter.departmentId) conditions.push(eq(purchaseRequests.departmentId, filter.departmentId));
      if (filter.requesterUserId) conditions.push(eq(purchaseRequests.requesterUserId, filter.requesterUserId));
      if (filter.priority) conditions.push(eq(purchaseRequests.priority, filter.priority));
      if (filter.fromDate) conditions.push(sql`${purchaseRequests.requestDate} >= ${filter.fromDate}`);
      if (filter.toDate) conditions.push(sql`${purchaseRequests.requestDate} <= ${filter.toDate}`);
      if (filter.search) {
        const term = `%${filter.search}%`;
        conditions.push(or(
          ilike(purchaseRequests.requestNumber, term),
          ilike(purchaseRequests.purpose, term),
          ilike(purchaseRequests.justification, term)
        )!);
      }

      const whereClause = and(...conditions);
      const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(purchaseRequests).where(whereClause);
      const total = countRow ? Number(countRow.count) : 0;

      const headers = await db.select()
        .from(purchaseRequests)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(sql`${purchaseRequests.createdAt} DESC`);

      const dtos: PurchaseRequestDTO[] = [];
      for (const header of headers) {
        const lines = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, header.id));
        dtos.push(this.mapToDTO(header, lines));
      }

      return { items: dtos, total };
    }

    // In-Memory Mode
    let list = Array.from(this.memoryStore.values()).filter(item => {
      if (item.tenantId !== ctx.tenantId || item.companyId !== filter.companyId) return false;
      if (filter.status && item.status !== filter.status) return false;
      if (filter.departmentId && item.departmentId !== filter.departmentId) return false;
      if (filter.requesterUserId && item.requesterUserId !== filter.requesterUserId) return false;
      if (filter.priority && item.priority !== filter.priority) return false;
      if (filter.fromDate && item.requestDate < filter.fromDate) return false;
      if (filter.toDate && item.requestDate > filter.toDate) return false;
      if (filter.search) {
        const term = filter.search.toLowerCase();
        const numMatch = item.requestNumber.toLowerCase().includes(term);
        const purpMatch = item.purpose?.toLowerCase().includes(term);
        const justMatch = item.justification?.toLowerCase().includes(term);
        if (!numMatch && !purpMatch && !justMatch) return false;
      }
      return true;
    });

    const total = list.length;
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const offset = (page - 1) * limit;
    list = list.slice(offset, offset + limit);

    return { items: list, total };
  }

  private mapToDTO(header: PurchaseRequest, lines: PurchaseRequestLine[]): PurchaseRequestDTO {
    return {
      id: header.id,
      tenantId: header.tenantId,
      companyId: header.companyId,
      branchId: header.branchId || null,
      departmentId: header.departmentId || null,
      requestNumber: header.requestNumber,
      requestDate: header.requestDate,
      requiredDate: header.requiredDate,
      requesterUserId: header.requesterUserId,
      requesterEmployeeId: header.requesterEmployeeId || null,
      purpose: header.purpose || null,
      justification: header.justification || null,
      priority: header.priority as any,
      status: header.status as any,
      preferredSupplierId: header.preferredSupplierId || null,
      projectId: header.projectId || null,
      costCenterId: header.costCenterId || null,
      currency: header.currency,
      estimatedTotal: header.estimatedTotal,
      notes: header.notes || null,
      submittedAt: header.submittedAt || null,
      submittedBy: header.submittedBy || null,
      approvedAt: header.approvedAt || null,
      approvedBy: header.approvedBy || null,
      rejectedAt: header.rejectedAt || null,
      rejectedBy: header.rejectedBy || null,
      rejectionReason: header.rejectionReason || null,
      cancelledAt: header.cancelledAt || null,
      cancelledBy: header.cancelledBy || null,
      cancellationReason: header.cancellationReason || null,
      version: header.version,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      createdBy: header.createdBy,
      updatedBy: header.updatedBy,
      lines: lines.map(line => ({
        id: line.id,
        purchaseRequestId: line.purchaseRequestId,
        lineNumber: line.lineNumber,
        productId: line.productId || null,
        description: line.description,
        requestedQuantity: line.requestedQuantity,
        orderedQuantity: line.orderedQuantity,
        remainingQuantity: line.remainingQuantity,
        uom: line.uom,
        estimatedUnitPrice: line.estimatedUnitPrice,
        estimatedDiscount: line.estimatedDiscount,
        estimatedTax: line.estimatedTax,
        estimatedLineTotal: line.estimatedLineTotal,
        requiredDate: line.requiredDate || null,
        preferredSupplierId: line.preferredSupplierId || null,
        specification: line.specification || null,
        notes: line.notes || null,
        projectId: line.projectId || null,
        costCenterId: line.costCenterId || null,
        version: line.version,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
      }))
    };
  }
}

export const purchaseRequestService = new PurchaseRequestService();
