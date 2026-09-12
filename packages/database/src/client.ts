import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as platformSchema from './schema/platform.js';
import * as masterSchema from './schema/master.js';
import * as commercialMasterSchema from './schema/commercial-master.js';
import * as accountingSchema from './schema/accounting.js';
import * as taxSchema from './schema/tax.js';

const { Pool } = pg;

export const schema = {
  ...platformSchema,
  ...masterSchema,
  ...commercialMasterSchema,
  ...accountingSchema,
  ...taxSchema
};

export function createDatabaseClient(connectionString?: string) {
  const connection = connectionString || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/general_erp';
  const pool = new Pool({ connectionString: connection });
  
  const client = drizzle(pool, { schema });
  activeDb = client;

  return {
    db: client,
    pool
  };
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>['db'];

let activeDb: DatabaseClient | undefined;

export function setDb(db: DatabaseClient | undefined) {
  activeDb = db;
}

export function getDb(): DatabaseClient | undefined {
  return activeDb;
}
