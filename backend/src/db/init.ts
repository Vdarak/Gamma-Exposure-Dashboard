import { pool } from './connection';
import fs from 'fs';
import path from 'path';

export async function initializeDatabase() {
  try {
    console.log('🔧 Initializing database schema...');
    
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );
    
    await pool.query(schemaSQL);
    console.log('✅ Database schema initialized successfully');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

export async function cleanOldData(daysToKeep: number = 3): Promise<number> {
  try {
    const result = await pool.query(
      'SELECT clean_old_snapshots($1)',
      [daysToKeep]
    );
    
    const deletedCount = result.rows[0].clean_old_snapshots;
    console.log(`🧹 Cleaned ${deletedCount} old snapshots`);
    
    return deletedCount;
  } catch (error) {
    console.error('❌ Failed to clean old data:', error);
    return 0;
  }
}
