import { pool } from '../db/connection';
import { JournalTrade } from '../types';

/**
 * Helper to map a database row to a JournalTrade object
 */
function mapRowToTrade(row: any): JournalTrade {
  return {
    id: row.id,
    // Convert Postgres Date objects to YYYY-MM-DD strings
    tradeDate: row.trade_date ? new Date(row.trade_date).toISOString().split('T')[0] : '',
    // Postgres TIME returns string like "09:30:00", slice to "09:30"
    timeEntered: row.time_entered ? row.time_entered.slice(0, 5) : null,
    timeExited: row.time_exited ? row.time_exited.slice(0, 5) : null,
    ticker: row.ticker,
    tradeType: row.trade_type,
    strike: row.strike ? parseFloat(row.strike) : null,
    optionType: row.option_type,
    expiration: row.expiration ? new Date(row.expiration).toISOString().split('T')[0] : null,
    direction: row.direction,
    quality: row.quality,
    pnl: parseFloat(row.pnl),
    pnlPercent: parseFloat(row.pnl_percent),
    screenshot: row.screenshot,
    rationale: row.rationale,
    strategy: row.strategy,
    quantity: parseFloat(row.quantity),
    entryPrice: parseFloat(row.entry_price),
    exitPrice: parseFloat(row.exit_price),
    fees: row.fees ? parseFloat(row.fees) : 0,
    status: row.status as 'Open' | 'Closed' || 'Closed',
    createdAt: row.created_at,
  };
}

/**
 * Retrieve all trades from the database ordered by date/time
 */
export async function getTrades(): Promise<JournalTrade[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM journal_trades 
       ORDER BY trade_date DESC, time_entered DESC NULLS LAST`
    );
    return result.rows.map(mapRowToTrade);
  } catch (error) {
    console.error('❌ Error fetching trades:', error);
    throw error;
  }
}

/**
 * Fetch a single trade by ID
 */
export async function getTradeById(id: string): Promise<JournalTrade | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM journal_trades WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapRowToTrade(result.rows[0]);
  } catch (error) {
    console.error(`❌ Error fetching trade with ID ${id}:`, error);
    throw error;
  }
}

/**
 * Create a new trade in the database
 */
export async function createTrade(trade: JournalTrade): Promise<JournalTrade> {
  try {
    const query = `
      INSERT INTO journal_trades (
        id, trade_date, time_entered, time_exited, ticker, trade_type, 
        strike, option_type, expiration, direction, quality, pnl, 
        pnl_percent, screenshot, rationale, strategy, quantity, 
        entry_price, exit_price, fees, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      ) RETURNING *
    `;
    
    const params = [
      trade.id,
      trade.tradeDate,
      trade.timeEntered || null,
      trade.timeExited || null,
      trade.ticker.toUpperCase(),
      trade.tradeType,
      trade.strike || null,
      trade.optionType || null,
      trade.expiration || null,
      trade.direction,
      trade.quality,
      trade.pnl,
      trade.pnlPercent,
      trade.screenshot || null,
      trade.rationale || null,
      trade.strategy || null,
      trade.quantity,
      trade.entryPrice,
      trade.exitPrice,
      trade.fees || 0,
      trade.status || 'Closed'
    ];

    const result = await pool.query(query, params);
    return mapRowToTrade(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating trade:', error);
    throw error;
  }
}

/**
 * Update an existing trade's details
 */
export async function updateTrade(id: string, trade: Partial<JournalTrade>): Promise<JournalTrade | null> {
  try {
    // Check if the trade exists
    const existing = await getTradeById(id);
    if (!existing) return null;

    // Standard UPDATE query updating all values from the partial or keeping previous values
    const query = `
      UPDATE journal_trades SET
        trade_date = $1,
        time_entered = $2,
        time_exited = $3,
        ticker = $4,
        trade_type = $5,
        strike = $6,
        option_type = $7,
        expiration = $8,
        direction = $9,
        quality = $10,
        pnl = $11,
        pnl_percent = $12,
        screenshot = $13,
        rationale = $14,
        strategy = $15,
        quantity = $16,
        entry_price = $17,
        exit_price = $18,
        fees = $19,
        status = $20
      WHERE id = $21
      RETURNING *
    `;

    const params = [
      trade.tradeDate !== undefined ? trade.tradeDate : existing.tradeDate,
      trade.timeEntered !== undefined ? trade.timeEntered : existing.timeEntered,
      trade.timeExited !== undefined ? trade.timeExited : existing.timeExited,
      trade.ticker !== undefined ? trade.ticker.toUpperCase() : existing.ticker,
      trade.tradeType !== undefined ? trade.tradeType : existing.tradeType,
      trade.strike !== undefined ? trade.strike : existing.strike,
      trade.optionType !== undefined ? trade.optionType : existing.optionType,
      trade.expiration !== undefined ? trade.expiration : existing.expiration,
      trade.direction !== undefined ? trade.direction : existing.direction,
      trade.quality !== undefined ? trade.quality : existing.quality,
      trade.pnl !== undefined ? trade.pnl : existing.pnl,
      trade.pnlPercent !== undefined ? trade.pnlPercent : existing.pnlPercent,
      trade.screenshot !== undefined ? trade.screenshot : existing.screenshot,
      trade.rationale !== undefined ? trade.rationale : existing.rationale,
      trade.strategy !== undefined ? trade.strategy : existing.strategy,
      trade.quantity !== undefined ? trade.quantity : existing.quantity,
      trade.entryPrice !== undefined ? trade.entryPrice : existing.entryPrice,
      trade.exitPrice !== undefined ? trade.exitPrice : existing.exitPrice,
      trade.fees !== undefined ? trade.fees : existing.fees,
      trade.status !== undefined ? trade.status : existing.status,
      id
    ];

    const result = await pool.query(query, params);
    return mapRowToTrade(result.rows[0]);
  } catch (error) {
    console.error(`❌ Error updating trade with ID ${id}:`, error);
    throw error;
  }
}

/**
 * Delete a trade by ID
 */
export async function deleteTrade(id: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'DELETE FROM journal_trades WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(`❌ Error deleting trade with ID ${id}:`, error);
    throw error;
  }
}
