import axios from 'axios';
import { pool } from '../db/connection';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface CotPosition {
  ticker: string;
  reportDate: string;
  openInterest: number;
  noncommLong: number;
  noncommShort: number;
  commLong: number;
  commShort: number;
  retailLong: number;
  retailShort: number;
}

// CFTC Market Names in the deafut.txt file
const COT_MARKET_MAP: { [key: string]: string } = {
  'SPX': 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE',
  'NDX': 'NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE',
  'GLD': 'GOLD - COMMODITY EXCHANGE INC.',
  'SLV': 'SILVER - COMMODITY EXCHANGE INC.',
  'USO': 'WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE',
  'TNX': 'UST 10Y NOTE - CHICAGO BOARD OF TRADE',
  'DXY': 'USD INDEX - ICE FUTURES U.S.',
  'IWM': 'RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE'
};


/**
 * Ingests latest weekly COT data from the CFTC
 */
export async function ingestCotData(): Promise<boolean> {
  console.log('⏰ Starting CFTC COT positioning data ingestion...');
  
  // Try to seed historical data first if missing
  try {
    await ingestHistoricalCot();
  } catch (e: any) {
    console.warn('⚠️ Failed to seed historical COT data:', e.message);
  }
  
  try {
    const url = 'https://www.cftc.gov/dea/newcot/deafut.txt';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/plain, */*',
      'Connection': 'keep-alive'
    };

    const response = await axios.get(url, { headers, timeout: 15000 });
    if (response.status !== 200 || !response.data) {
      throw new Error(`Failed to fetch COT report: HTTP ${response.status}`);
    }

    const rows = response.data.split('\n');
    if (rows.length < 2) {
      throw new Error('COT report data empty or malformed');
    }

    // CFTC CSV format details:
    // Column 0: Market_and_Market_Type
    // Column 2: Report_Date_as_YYYY-MM-DD
    // Column 7: NonComm_Positions_Long_All (Speculators Long)
    // Column 8: NonComm_Positions_Short_All (Speculators Short)
    // Column 11: Comm_Positions_Long_All (Commercials Long)
    // Column 12: Comm_Positions_Short_All (Commercials Short)
    // Column 17: NonRept_Positions_Long_All (Retail Long)
    // Column 18: NonRept_Positions_Short_All (Retail Short)
    
    let processedCount = 0;
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const row of rows) {
        if (!row.trim()) continue;
        
        // Split by comma, handling potential quotes (standard CSV parsing)
        const cols = row.split(',').map((c: string) => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 20) continue;
        
        const marketName = cols[0];
        
        // Find if this is one of our watched macro markets
        const ticker = Object.keys(COT_MARKET_MAP).find(
          key => COT_MARKET_MAP[key].toLowerCase() === marketName.toLowerCase()
        );
        
        if (ticker) {
          const reportDateStr = cols[2];
          const openInterest = parseInt(cols[7] || '0', 10);
          const noncommLong = parseInt(cols[8] || '0', 10);
          const noncommShort = parseInt(cols[9] || '0', 10);
          const commLong = parseInt(cols[11] || '0', 10);
          const commShort = parseInt(cols[12] || '0', 10);
          const retailLong = parseInt(cols[15] || '0', 10);
          const retailShort = parseInt(cols[16] || '0', 10);

          if (!isNaN(Date.parse(reportDateStr))) {
            await client.query(
              `INSERT INTO cot_positions (
                ticker, report_date, open_interest, noncomm_long, noncomm_short, comm_long, comm_short, retail_long, retail_short
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (ticker, report_date) DO UPDATE
              SET 
                open_interest = EXCLUDED.open_interest,
                noncomm_long = EXCLUDED.noncomm_long,
                noncomm_short = EXCLUDED.noncomm_short,
                comm_long = EXCLUDED.comm_long,
                comm_short = EXCLUDED.comm_short,
                retail_long = EXCLUDED.retail_long,
                retail_short = EXCLUDED.retail_short`,
              [ticker, reportDateStr, openInterest, noncommLong, noncommShort, commLong, commShort, retailLong, retailShort]
            );
            processedCount++;
          }
        }
      }
      
      await client.query('COMMIT');
      console.log(`✅ CFTC COT Ingestion complete: successfully updated ${processedCount} records`);
      client.release();
      return true;
    } catch (dbErr) {
      await client.query('ROLLBACK');
      client.release();
      throw dbErr;
    }
  } catch (error: any) {
    console.error('❌ Failed to ingest COT data from CFTC:', error.message);
    return false;
  }
}


/**
 * Retrieves historical COT data for a macro ticker
 */
export async function getHistoricalCot(ticker: string, limit = 104): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT 
        report_date as "reportDate",
        open_interest as "openInterest",
        noncomm_long as "noncommLong",
        noncomm_short as "noncommShort",
        comm_long as "commLong",
        comm_short as "commShort",
        retail_long as "retailLong",
        retail_short as "retailShort"
      FROM cot_positions
      WHERE ticker = $1
      ORDER BY report_date ASC
      LIMIT $2`,
      [ticker.toUpperCase(), limit]
    );
    
    return result.rows.map(row => {
      const openInterest = parseInt(row.openInterest || '0');
      const cLong = parseInt(row.commLong);
      const cShort = parseInt(row.commShort);
      const ncLong = parseInt(row.noncommLong);
      const ncShort = parseInt(row.noncommShort);
      const rLong = parseInt(row.retailLong);
      const rShort = parseInt(row.retailShort);
      
      const commNet = cLong - cShort;
      const noncommNet = ncLong - ncShort;
      const retailNet = rLong - rShort;
      
      return {
        reportDate: new Date(row.reportDate).toISOString().split('T')[0],
        openInterest,
        commLong: cLong,
        commShort: cShort,
        commNet,
        noncommLong: ncLong,
        noncommShort: ncShort,
        noncommNet,
        retailLong: rLong,
        retailShort: rShort,
        retailNet
      };
    });
  } catch (error) {
    console.error(`❌ Error fetching historical COT data for ${ticker}:`, error);
    return [];
  }
}

/**
 * Ingests/seeds historical COT data from the CFTC 2026 ZIP archive
 */
export async function ingestHistoricalCot(): Promise<boolean> {
  console.log('⏰ Checking historical CFTC COT data...');
  const client = await pool.connect();
  try {
    const checkCount = await client.query('SELECT COUNT(*) as count FROM cot_positions');
    const count = parseInt(checkCount.rows[0].count, 10);
    // If we already have historical records, skip historical seeding
    if (count > 400) {
      console.log('✅ Historical COT data already exists, skipping seed.');
      client.release();
      return true;
    }
    
    console.log('ℹ️ Historical COT data is empty or insufficient. Initializing seed for 2025 and 2026...');
    
    const tempDir = path.join(__dirname, '../../tmp/temp_cot');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
    
    let totalProcessed = 0;
    const years = [2025, 2026];
    
    for (const year of years) {
      const url = `https://www.cftc.gov/files/dea/history/deacot${year}.zip`;
      const zipPath = path.join(tempDir, `deacot${year}.zip`);
      console.log(`Downloading historical ZIP for ${year} from ${url} to ${zipPath}...`);
      
      try {
        const response = await axios({
          url,
          method: 'GET',
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        const writer = fs.createWriteStream(zipPath);
        response.data.pipe(writer);
        
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', () => resolve());
          writer.on('error', (err) => reject(err));
        });
        
        console.log(`Extracting ${year} ZIP file...`);
        execSync(`unzip -o "${zipPath}" -d "${tempDir}"`);
        
        const txtPath = path.join(tempDir, 'annual.txt');
        if (!fs.existsSync(txtPath)) {
          throw new Error('annual.txt not found in extracted files');
        }
        
        const content = fs.readFileSync(txtPath, 'utf-8');
        const rows = content.split('\n');
        console.log(`Successfully read annual.txt for ${year}. Total rows: ${rows.length}. Parsing...`);
        
        await client.query('BEGIN');
        let yearProcessed = 0;
        
        for (const row of rows) {
          if (!row.trim()) continue;
          
          const cols = row.split(',').map((c: string) => c.trim().replace(/^"|"$/g, ''));
          if (cols.length < 20) continue;
          
          // Skip header row
          if (cols[0] === 'Market and Exchange Names') continue;
          
          const marketName = cols[0];
          const ticker = Object.keys(COT_MARKET_MAP).find(
            key => COT_MARKET_MAP[key].toLowerCase() === marketName.toLowerCase()
          );
          
          if (ticker) {
            const reportDateStr = cols[2];
            const openInterest = parseInt(cols[7] || '0', 10);
            const noncommLong = parseInt(cols[8] || '0', 10);
            const noncommShort = parseInt(cols[9] || '0', 10);
            const commLong = parseInt(cols[11] || '0', 10);
            const commShort = parseInt(cols[12] || '0', 10);
            const retailLong = parseInt(cols[15] || '0', 10);
            const retailShort = parseInt(cols[16] || '0', 10);
            
            if (!isNaN(Date.parse(reportDateStr))) {
              await client.query(
                `INSERT INTO cot_positions (
                  ticker, report_date, open_interest, noncomm_long, noncomm_short, comm_long, comm_short, retail_long, retail_short
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (ticker, report_date) DO UPDATE
                SET 
                  open_interest = EXCLUDED.open_interest,
                  noncomm_long = EXCLUDED.noncomm_long,
                  noncomm_short = EXCLUDED.noncomm_short,
                  comm_long = EXCLUDED.comm_long,
                  comm_short = EXCLUDED.comm_short,
                  retail_long = EXCLUDED.retail_long,
                  retail_short = EXCLUDED.retail_short`,
                [ticker, reportDateStr, openInterest, noncommLong, noncommShort, commLong, commShort, retailLong, retailShort]
              );
              yearProcessed++;
            }
          }
        }
        
        await client.query('COMMIT');
        console.log(`✅ Loaded ${yearProcessed} records for ${year}.`);
        totalProcessed += yearProcessed;
        
        // Clean up extracted files for the next loop iteration
        try {
          fs.unlinkSync(txtPath);
        } catch (e) {
          // ignore
        }
      } catch (err: any) {
        console.error(`❌ Failed to seed historical data for ${year}:`, err.message);
        throw err;
      }
    }
    
    console.log(`✅ Historical COT Seeding complete: successfully loaded ${totalProcessed} total records across 2025 and 2026`);
    
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    
    client.release();
    return true;
  } catch (error: any) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Failed to seed historical COT data:', error.message);
    return false;
  }
}

