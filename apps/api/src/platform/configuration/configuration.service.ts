import { ValidationError } from '@general-erp/core';

export interface CustomFieldDefinition {
  fieldName: string;
  fieldLabel: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'select';
  isRequired: boolean;
  options?: string[];
}

export class ConfigurationService {
  private configStore = new Map<string, unknown>();

  /**
   * Set configuration value
   */
  setConfig(tenantId: string, module: string, key: string, value: unknown): void {
    const storeKey = `${tenantId}:${module}:${key}`;
    this.configStore.set(storeKey, value);
  }

  /**
   * Get configuration value with fallback default
   */
  getConfig<T>(tenantId: string, module: string, key: string, defaultValue?: T): T {
    const storeKey = `${tenantId}:${module}:${key}`;
    if (this.configStore.has(storeKey)) {
      return this.configStore.get(storeKey) as T;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Configuration key '${key}' in module '${module}' not found for tenant '${tenantId}'.`);
  }

  /**
   * Validate custom fields object against entity field definitions
   */
  validateCustomFields(customFields: Record<string, unknown>, definitions: CustomFieldDefinition[]): void {
    for (const def of definitions) {
      const val = customFields[def.fieldName];
      
      if (def.isRequired && (val === undefined || val === null || val === '')) {
        throw new ValidationError(`Custom field '${def.fieldLabel}' (${def.fieldName}) is required.`);
      }

      if (val !== undefined && val !== null) {
        if (def.dataType === 'number' && typeof val !== 'number') {
          throw new ValidationError(`Custom field '${def.fieldLabel}' must be a number.`);
        }
        if (def.dataType === 'boolean' && typeof val !== 'boolean') {
          throw new ValidationError(`Custom field '${def.fieldLabel}' must be a boolean.`);
        }
        if (def.dataType === 'select' && def.options && !def.options.includes(String(val))) {
          throw new ValidationError(`Custom field '${def.fieldLabel}' must be one of: ${def.options.join(', ')}.`);
        }
      }
    }
  }
}

export const configurationService = new ConfigurationService();
