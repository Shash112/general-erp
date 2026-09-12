import { UserSession, ForbiddenError } from '@general-erp/core';

export interface AuthorizeOptions {
  user: UserSession;
  action: string;             // e.g., 'sales:invoice:create', 'accounting:journal:post'
  resourceId?: string;
  resourceOwnerId?: string;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  creatorId?: string;         // For Segregation of Duties checks
}

export class AuthorizationService {
  /**
   * Evaluate whether an action is permitted for the given context
   */
  authorize(options: AuthorizeOptions): boolean {
    const { user, action, creatorId } = options;

    // 1. Segregation of Duties Check (Creator cannot approve or post their own document)
    if (action.includes('approve') || action.includes('post')) {
      const isWildcardUser = user.permissions.includes('*') || user.permissions.includes('sod:override');
      if (creatorId && creatorId === user.userId && !isWildcardUser) {
        throw new ForbiddenError(`Segregation of duties violation: Creator '${user.userId}' cannot perform '${action}' on their own document.`);
      }
    }

    // 2. Check Action Permissions (Wildcard '*' or exact action string match)
    const hasActionPermission = user.permissions.some(p => p === '*' || p === action || (p.endsWith(':*') && action.startsWith(p.slice(0, -2))));
    
    if (!hasActionPermission) {
      throw new ForbiddenError(`Permission denied: User does not have authorization for action '${action}'.`);
    }

    // 3. Data Scope Evaluation
    this.evaluateDataScope(options);

    return true;
  }

  private evaluateDataScope(options: AuthorizeOptions): void {
    const { user, companyId, branchId, departmentId, resourceOwnerId } = options;

    // Check Company Scope
    if (companyId && user.companyId && companyId !== user.companyId) {
      throw new ForbiddenError(`Data scope violation: User belongs to company '${user.companyId}', requested company '${companyId}'.`);
    }

    // Check Branch Scope (if user has branch restriction)
    if (branchId && user.branchId && branchId !== user.branchId) {
      throw new ForbiddenError(`Data scope violation: User restricted to branch '${user.branchId}', requested branch '${branchId}'.`);
    }

    // Check Department Scope
    if (departmentId && user.departmentId && departmentId !== user.departmentId) {
      throw new ForbiddenError(`Data scope violation: User restricted to department '${user.departmentId}', requested department '${departmentId}'.`);
    }

    // Check Self Scope
    if (resourceOwnerId && user.permissions.includes('scope:self') && resourceOwnerId !== user.userId) {
      throw new ForbiddenError(`Data scope violation: User restricted to personal resources.`);
    }
  }
}

export const authorizationService = new AuthorizationService();
