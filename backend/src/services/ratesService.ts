import axios from 'axios';
import { pool } from '../db/connection';

export interface RatesData {
  usRiskFreeRate: number;
  indiaRiskFreeRate: number;
  source: string;
  updatedAt?: Date;
}

/**
 * Fetch latest rates from Yahoo Finance and update the database
 */
export async function updateRates(): Promise<RatesData> {
  console.log('⏰ Updating interest rates from Yahoo Finance...');
  let usRate = 0.0525; // 5.25% default US fallback
  let indiaRate = 0.0650; // 6.50% default India fallback
  let source = 'Yahoo Finance (Fallback)';

  try {
    // US 3-Month Treasury Bill Yield symbol ^IRX
    const usResponse = await axios.get(
      'https://query1.finance.yahoo.com/v8/finance/chart/^IRX?interval=1d&range=1d',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 10000,
      }
    );

    if (usResponse.status === 200) {
      const data = usResponse.data;
      const lastClose = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (lastClose !== undefined && lastClose > 0) {
        usRate = lastClose / 100; // e.g. 5.3% -> 0.053
        source = `Yahoo Finance (^IRX: ${lastClose.toFixed(2)}%)`;
      }
    }
  } catch (error: any) {
    console.error('⚠️ Failed to fetch US rate from Yahoo:', error.message);
  }

  try {
    // India 10Y Government Bond yield symbol is often "^IN10Y" or we can use RBI Repo Rate benchmark
    // Let's try to query India 10Y yield from Yahoo Finance: CCIL 10 Yr G-Sec index or IN10Y.NS
    const indiaResponse = await axios.get(
      'https://query1.finance.yahoo.com/v8/finance/chart/IN10Y.NS?interval=1d&range=1d',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 10000,
      }
    );

    if (indiaResponse.status === 200) {
      const data = indiaResponse.data;
      const lastClose = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (lastClose !== undefined && lastClose > 0) {
        indiaRate = lastClose / 100;
        source += ` / Yahoo Finance (IN10Y.NS: ${lastClose.toFixed(2)}%)`;
      }
    }
  } catch (error: any) {
    console.log('ℹ️ Using standard RBI Repo Rate benchmark (6.5%) as India fallback');
    source += ` / RBI Benchmark (6.50%)`;
  }

  // Save/Upsert into the database
  try {
    await pool.query(
      `INSERT INTO interest_rates (rate_key, rate, source, updated_at)
       VALUES ('US_RISK_FREE', $1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (rate_key) DO UPDATE 
       SET rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = CURRENT_TIMESTAMP`,
      [usRate, source]
    );

    await pool.query(
      `INSERT INTO interest_rates (rate_key, rate, source, updated_at)
       VALUES ('INDIA_RISK_FREE', $1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (rate_key) DO UPDATE 
       SET rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = CURRENT_TIMESTAMP`,
      [indiaRate, source]
    );

    console.log(`✅ Stored rates: US=${(usRate * 100).toFixed(2)}%, India=${(indiaRate * 100).toFixed(2)}%`);
  } catch (error) {
    console.error('❌ Failed to store interest rates in database:', error);
  }

  return {
    usRiskFreeRate: usRate,
    indiaRiskFreeRate: indiaRate,
    source,
    updatedAt: new Date(),
  };
}

/**
 * Retrieve the latest interest rates from the database
 */
export async function getStoredRates(): Promise<RatesData> {
  try {
    const result = await pool.query(
      "SELECT rate_key, rate, source, updated_at FROM interest_rates"
    );

    let usRiskFreeRate = 0.0525;
    let indiaRiskFreeRate = 0.0650;
    let source = 'Defaults (No database entries)';
    let updatedAt = new Date();

    if (result.rows.length > 0) {
      source = 'Database';
      result.rows.forEach((row) => {
        if (row.rate_key === 'US_RISK_FREE') {
          usRiskFreeRate = parseFloat(row.rate);
          updatedAt = row.updated_at;
        } else if (row.rate_key === 'INDIA_RISK_FREE') {
          indiaRiskFreeRate = parseFloat(row.rate);
        }
      });
      
      const sources = result.rows.map(r => r.source).filter(Boolean);
      if (sources.length > 0) {
        source = sources.join(' / ');
      }
    } else {
      // Seed initial rates if missing
      return await updateRates();
    }

    return {
      usRiskFreeRate,
      indiaRiskFreeRate,
      source,
      updatedAt,
    };
  } catch (error) {
    console.error('❌ Failed to get stored interest rates:', error);
    return {
      usRiskFreeRate: 0.0525,
      indiaRiskFreeRate: 0.0650,
      source: 'Assumed Defaults (Error Fallback)',
      updatedAt: new Date(),
    };
  }
}
