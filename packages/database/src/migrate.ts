import fs from 'fs';
import path from 'path';
import { createDatabaseClient } from './client.js';

export async function runMigrations() {
  const { pool } = createDatabaseClient();
  const migrationsDir = path.resolve(process.cwd(), 'migrations');

  console.log('🔄 Running database migrations...');
  
  try {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    
    for (const file of files) {
      console.log(`Executing migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      await pool.query(sql);
    }
    
    console.log('✅ All migrations applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    await pool.end();
  }
}
