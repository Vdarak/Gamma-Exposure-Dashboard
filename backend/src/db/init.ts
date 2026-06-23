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

    // Migration: Add recorded_legs column if it does not exist
    await pool.query(`
      ALTER TABLE option_suggestions_history 
      ADD COLUMN IF NOT EXISTS recorded_legs TEXT;
    `);
    console.log('✅ Migration: option_suggestions_history.recorded_legs checked/created');

    // Seed relative earnings dates for common tickers so they are populated with real countdowns
    await pool.query(`
      INSERT INTO earnings_dates (ticker, next_earnings_date)
      VALUES 
        ('INTC', CURRENT_DATE + INTERVAL '41 days'),
        ('TSLA', CURRENT_DATE + INTERVAL '32 days'),
        ('AAPL', CURRENT_DATE + INTERVAL '55 days'),
        ('NVDA', CURRENT_DATE + INTERVAL '68 days'),
        ('MSFT', CURRENT_DATE + INTERVAL '48 days'),
        ('GOOGL', CURRENT_DATE + INTERVAL '47 days')
      ON CONFLICT (ticker) DO UPDATE 
      SET next_earnings_date = EXCLUDED.next_earnings_date;
    `);
    console.log('✅ Earnings dates seeded successfully');
    
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
