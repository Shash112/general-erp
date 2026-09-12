import { BusinessRuleViolationError } from '@general-erp/core';

export enum DocumentState {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVAL_PENDING = 'APPROVAL_PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  POSTED = 'POSTED',
  CANCELLED = 'CANCELLED'
}

export const ALLOWED_STATE_TRANSITIONS: Record<DocumentState, DocumentState[]> = {
  [DocumentState.DRAFT]: [DocumentState.SUBMITTED, DocumentState.CANCELLED],
  [DocumentState.SUBMITTED]: [DocumentState.APPROVAL_PENDING, DocumentState.APPROVED, DocumentState.REJECTED, DocumentState.CANCELLED],
  [DocumentState.APPROVAL_PENDING]: [DocumentState.APPROVED, DocumentState.REJECTED, DocumentState.CANCELLED],
  [DocumentState.APPROVED]: [DocumentState.POSTED, DocumentState.CANCELLED],
  [DocumentState.REJECTED]: [DocumentState.DRAFT, DocumentState.CANCELLED],
  [DocumentState.POSTED]: [DocumentState.CANCELLED], // Note: Cancelled on posted document triggers reversal
  [DocumentState.CANCELLED]: []
};

export class WorkflowService {
  /**
   * Validate state transition for document lifecycle
   */
  validateStateTransition(currentState: DocumentState, nextState: DocumentState): void {
    const allowed = ALLOWED_STATE_TRANSITIONS[currentState] || [];
    if (!allowed.includes(nextState)) {
      throw new BusinessRuleViolationError(
        `Invalid document state transition from '${currentState}' to '${nextState}'. Allowed transitions: [${allowed.join(', ')}].`
      );
    }
  }
}

export const workflowService = new WorkflowService();
