import { pgTable, uuid, varchar, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  roles: jsonb('roles').notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantEmailIdx: uniqueIndex('idx_users_tenant_email').on(table.tenantId, table.email)
}));

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tokenHashIdx: uniqueIndex('idx_sessions_token_hash').on(table.tokenHash)
}));

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  permissions: jsonb('permissions').notNull().default([]),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantRoleCodeIdx: uniqueIndex('idx_roles_tenant_code').on(table.tenantId, table.code)
}));

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  actorId: varchar('actor_id', { length: 255 }).notNull(),
  actorIp: varchar('actor_ip', { length: 64 }).notNull(),
  userAgent: text('user_agent').notNull(),
  module: varchar('module', { length: 64 }).notNull(),
  entityName: varchar('entity_name', { length: 100 }).notNull(),
  entityId: varchar('entity_id', { length: 255 }).notNull(),
  action: varchar('action', { length: 64 }).notNull(),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  reason: text('reason'),
  traceId: varchar('trace_id', { length: 128 }).notNull(),
  hash: varchar('hash', { length: 128 }).notNull(),
  prevHash: varchar('prev_hash', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantEntityIdx: index('idx_audit_tenant_entity').on(table.tenantId, table.entityName, table.entityId),
  traceIdIdx: index('idx_audit_trace_id').on(table.traceId)
}));

export const configurations = pgTable('configurations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  module: varchar('module', { length: 64 }).notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  value: jsonb('value').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantKeyIdx: uniqueIndex('idx_config_tenant_mod_key').on(table.tenantId, table.module, table.key)
}));

export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  fieldName: varchar('field_name', { length: 64 }).notNull(),
  fieldLabel: varchar('field_label', { length: 128 }).notNull(),
  dataType: varchar('data_type', { length: 32 }).notNull(),
  isRequired: boolean('is_required').notNull().default(false),
  options: jsonb('options'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantEntityFieldIdx: uniqueIndex('idx_custom_field_tenant_entity').on(table.tenantId, table.entityType, table.fieldName)
}));

export const workflowDefinitions = pgTable('workflow_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  triggerEvent: varchar('trigger_event', { length: 64 }).notNull(),
  dagConfig: jsonb('dag_config').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const workflowInstances = pgTable('workflow_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  workflowDefinitionId: uuid('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  entityId: varchar('entity_id', { length: 255 }).notNull(),
  currentStatus: varchar('current_status', { length: 64 }).notNull(),
  history: jsonb('history').notNull().default([]),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const businessRules = pgTable('business_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  module: varchar('module', { length: 64 }).notNull(),
  ruleType: varchar('rule_type', { length: 64 }).notNull(),
  expression: jsonb('expression').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  key: varchar('key', { length: 255 }).notNull(),
  requestHash: varchar('request_hash', { length: 128 }).notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantKeyIdx: uniqueIndex('idx_idempotency_tenant_key').on(table.tenantId, table.key)
}));

export const jobFailures = pgTable('job_failures', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  queueName: varchar('queue_name', { length: 64 }).notNull(),
  jobName: varchar('job_name', { length: 128 }).notNull(),
  jobData: jsonb('job_data').notNull(),
  errorMessage: text('error_message').notNull(),
  failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow()
});

export const numberingSequences = pgTable('numbering_sequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull(),
  companyId: varchar('company_id', { length: 64 }).notNull(),
  documentType: varchar('document_type', { length: 64 }).notNull(),
  fiscalYear: varchar('fiscal_year', { length: 32 }).notNull(),
  branchCode: varchar('branch_code', { length: 32 }).notNull().default('DEFAULT'),
  currentSequence: integer('current_sequence').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantSeqIdx: uniqueIndex('idx_num_seq_tenant_doc').on(
    table.tenantId, table.companyId, table.documentType, table.fiscalYear, table.branchCode
  )
}));

