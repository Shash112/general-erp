export interface RuleCondition {
  field: string;
  operator: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains';
  value: unknown;
}

export interface BusinessRule {
  id: string;
  name: string;
  module: string;
  conditions: RuleCondition[];
  action: 'BLOCK' | 'REQUIRE_APPROVAL' | 'WARN' | 'APPLY_DISCOUNT';
  actionMessage: string;
}

export class RulesEngine {
  /**
   * Safely resolve nested property values (e.g., 'customer.creditLimit')
   */
  private resolveNestedPath(obj: Record<string, unknown>, pathStr: string): unknown {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = pathStr.split('.');
    let current: any = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Evaluate a single condition deterministically without eval()
   */
  evaluateCondition(condition: RuleCondition, context: Record<string, unknown>): boolean {
    const fieldValue = this.resolveNestedPath(context, condition.field);

    if (fieldValue === undefined || fieldValue === null) {
      // Null handling
      if (condition.operator === '==') return condition.value === null || condition.value === undefined;
      if (condition.operator === '!=') return condition.value !== null && condition.value !== undefined;
      return false;
    }

    switch (condition.operator) {
      case '==':
        return fieldValue === condition.value;
      case '!=':
        return fieldValue !== condition.value;
      case '>':
        return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue > condition.value;
      case '>=':
        return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue >= condition.value;
      case '<':
        return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue < condition.value;
      case '<=':
        return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue <= condition.value;
      case 'in':
        return Array.isArray(condition.value) && (condition.value as unknown[]).includes(fieldValue);
      case 'contains':
        return typeof fieldValue === 'string' && fieldValue.includes(String(condition.value));
      default:
        return false;
    }
  }

  /**
   * Evaluate all rules for a given domain context (with recursion depth limit guard)
   */
  evaluateRules(rules: BusinessRule[], context: Record<string, unknown>, maxRules: number = 100): BusinessRule[] {
    const triggeredRules: BusinessRule[] = [];
    const rulesToProcess = rules.slice(0, maxRules);

    for (const rule of rulesToProcess) {
      if (!rule || !Array.isArray(rule.conditions)) continue;
      const allConditionsMet = rule.conditions.every(cond => this.evaluateCondition(cond, context));
      if (allConditionsMet) {
        triggeredRules.push(rule);
      }
    }

    return triggeredRules;
  }
}

export const rulesEngine = new RulesEngine();
