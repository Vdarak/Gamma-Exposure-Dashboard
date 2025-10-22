import axios from 'axios';
import https from 'https';
import http from 'http';
import { pool } from '../db/connection';
import { OptionData, OptionSnapshot } from '../types';

interface CBOEOptionData {
  option: string;
  strike: number;
  option_type: 'call' | 'put';
  expiration_date: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
  open_interest: number;
  iv: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
}

interface CBOEResponse {
  current_price?: number;
  price?: number;
  options: CBOEOptionData[];
}

interface NSEOptionData {
  strikePrice: number;
  expiryDate: string;
  underlying: string;
  identifier: string;
  openInterest: number;
  changeinOpenInterest: number;
  pchangeinOpenInterest: number;
  totalTradedVolume: number;
  impliedVolatility: number;
  lastPrice: number;
  change: number;
  pChange: number;
  totalBuyQuantity: number;
  totalSellQuantity: number;
  bidQty: number;
  bidprice: number;
  askQty: number;
  askPrice: number;
  underlyingValue: number;
}

interface NSEResponse {
  records: {
    data: Array<{
      strikePrice: number;
      expiryDate: string;
      CE?: NSEOptionData;
      PE?: NSEOptionData;
    }>;
    underlyingValue: number;
  };
  filtered?: {
    data: Array<{
      strikePrice: number;
      expiryDate: string;
      CE?: NSEOptionData;
      PE?: NSEOptionData;
    }>;
  };
}

// Market identifiers
const US_TICKERS = ['SPX', 'GLD', 'TSLA'];
const INDIA_TICKERS = ['NIFTY', 'BANKNIFTY', 'RELIANCE'];

// Create HTTPS agent with proper connection settings
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  ciphers: 'DEFAULT:!DH',
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
});

/**
 * Fetch option chain data from CBOE API (US Market)
 * Includes retry logic with exponential backoff for 403 errors
 * Uses proper HTTP/2 compatible settings and connection pooling
 */
async function fetchOptionChainFromCBOE(ticker: string): Promise<CBOEResponse | null> {
  const maxRetries = 4;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`   [CBOE ${ticker}] Attempt ${attempt}/${maxRetries}...`);
      
      // Enhanced headers to mimic real browser and avoid CloudFront blocking
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.cboe.com/',
        'Origin': 'https://www.cboe.com',
        'Sec-CH-UA': '"Not A(Brand";v="99", "Google Chrome";v="131", "Chromium";v="131"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      };

      // Add request ID to make each request unique (helps bypass caching)
      const requestId = Math.random().toString(36).substr(2, 9);
      const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/_${ticker}.json?_=${requestId}`;

      console.log(`   [CBOE ${ticker}] Requesting: ${url}`);
      console.log(`   [CBOE ${ticker}] User-Agent: ${headers['User-Agent'].substring(0, 50)}...`);

      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        httpAgent,
        httpsAgent,
        validateStatus: (status) => status < 500, // Don't throw on 4xx, handle manually
      });

      if (response.status === 403) {
        console.error(`   [CBOE ${ticker}] ❌ CloudFront 403 - Trying fallback URL...`);
        
        // Try without underscore prefix as fallback
        const fallbackUrl = `https://cdn.cboe.com/api/global/delayed_quotes/options/${ticker}.json?_=${requestId}`;
        console.log(`   [CBOE ${ticker}] Fallback: ${fallbackUrl}`);
        
        const fallbackResponse = await axios.get(fallbackUrl, {
          headers,
          timeout: 15000,
          httpAgent,
          httpsAgent,
          validateStatus: (status) => status < 500,
        });
        
        if (fallbackResponse.status === 200) {
          console.log(`   [CBOE ${ticker}] ✅ Fallback URL succeeded!`);
          let data = fallbackResponse.data;
          if (data.data && typeof data.data === 'object') {
            data = data.data;
          }
          return data;
        }
        
        if (attempt < maxRetries) {
          const waitTime = Math.min(3000 * attempt, 20000); // 3s, 6s, 9s, 12s
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        return null;
      }

      if (response.status !== 200) {
        console.error(`   [CBOE ${ticker}] ❌ HTTP ${response.status}`);
        return null;
      }

      let data = response.data;

      // If data is nested under a "data" key, extract it
      if (data.data && typeof data.data === 'object') {
        data = data.data;
      }

      console.log(`   [CBOE ${ticker}] ✅ Successfully fetched data (status: ${response.status})`);
      return data;
    } catch (error: any) {
      const statusCode = error.response?.status;
      console.error(`   [CBOE ${ticker}] ❌ Attempt ${attempt}/${maxRetries} error (${statusCode}):`, error.message);
      
      if (attempt === maxRetries) {
        console.error(`   [CBOE ${ticker}] Failed after ${maxRetries} attempts`);
        return null;
      }
      
      // Wait before retry
      const waitTime = Math.min(3000 * attempt, 20000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  console.error(`❌ Failed to fetch data for ${ticker} from CBOE after ${maxRetries} attempts`);
  return null;
}

/**
 * Fetch option chain data from NSE API (Indian Market)
 * NSE requires cookies and specific headers
 * Using native fetch (same approach as working frontend)
 */
async function fetchOptionChainFromNSE(ticker: string): Promise<NSEResponse | null> {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`   [NSE ${ticker}] Attempt ${attempt}/${maxRetries} - Getting fresh cookies...`);
      
      // Step 1: Hit the option-chain page to get cookies (same as frontend)
      const optionChainHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
      };

      const optionChainResponse = await axios.get('https://www.nseindia.com/option-chain', {
        headers: optionChainHeaders,
        timeout: 10000,
        maxRedirects: 5,
        httpAgent,
        httpsAgent,
      });

      console.log(`   [NSE ${ticker}] Option-chain page status: ${optionChainResponse.status}`);

      // Extract and format cookies properly (same as frontend)
      const setCookies = optionChainResponse.headers['set-cookie'];
      if (!setCookies || setCookies.length === 0) {
        throw new Error('No cookies received from NSE');
      }
      
      const cookies = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
      console.log(`   [NSE ${ticker}] Got ${setCookies.length} cookies: ${cookies.substring(0, 50)}...`);

      // Wait to mimic human behavior
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));

      // Step 2: Use cookies to fetch API data
      let apiUrl: string;
      if (ticker === 'NIFTY' || ticker === 'BANKNIFTY' || ticker === 'FINNIFTY') {
        apiUrl = `https://www.nseindia.com/api/option-chain-indices?symbol=${ticker}`;
      } else {
        apiUrl = `https://www.nseindia.com/api/option-chain-equities?symbol=${ticker}`;
      }

      console.log(`   [NSE ${ticker}] Fetching from: ${apiUrl}`);
      
      const apiHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.nseindia.com/option-chain',
        'Origin': 'https://www.nseindia.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookies,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Connection': 'keep-alive',
      };

      const response = await axios.get(apiUrl, {
        headers: apiHeaders,
        timeout: 15000,
        maxRedirects: 5,
        httpAgent,
        httpsAgent,
      });

      console.log(`   [NSE ${ticker}] ✅ Successfully fetched data (status: ${response.status})`);
      return response.data;
      
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      
      if (error.response?.status === 403) {
        console.error(`   [NSE ${ticker}] ❌ 403 Forbidden (cookies rejected) - Attempt ${attempt}/${maxRetries}`);
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        console.error(`   [NSE ${ticker}] ❌ Timeout - Attempt ${attempt}/${maxRetries}`);
      } else {
        console.error(`   [NSE ${ticker}] ❌ Error: ${error.message} - Attempt ${attempt}/${maxRetries}`);
      }
      
      if (isLastAttempt) {
        console.error(`   [NSE ${ticker}] Failed after ${maxRetries} attempts`);
        return null;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.min(5000 * attempt, 15000);
      console.log(`   [NSE ${ticker}] Waiting ${waitTime/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  return null;
}

/**
 * Normalize CBOE data to our internal format
 * Includes validation for invalid dates and data
 */
function normalizeCBOEOptionData(cboeOptions: CBOEOptionData[]): OptionData[] {
  return cboeOptions
    .filter(option => {
      // Filter out invalid options
      if (!option.expiration_date || !option.strike || !option.option_type) {
        console.warn(`   [CBOE] Skipping invalid option: ${JSON.stringify(option)}`);
        return false;
      }
      
      // Check if date is valid
      const expirationDate = new Date(option.expiration_date);
      if (isNaN(expirationDate.getTime())) {
        console.warn(`   [CBOE] Skipping option with invalid date: ${option.expiration_date}`);
        return false;
      }
      
      return true;
    })
    .map(option => {
      const expirationDate = new Date(option.expiration_date);
      
      return {
        strike: option.strike,
        type: option.option_type === 'call' ? 'C' : 'P',
        expiration: expirationDate,
        lastPrice: option.last || 0,
        bid: option.bid || 0,
        ask: option.ask || 0,
        volume: option.volume || 0,
        openInterest: option.open_interest || 0,
        impliedVolatility: option.iv || 0,
        delta: option.delta || 0,
        gamma: option.gamma || 0,
        theta: option.theta || 0,
        vega: option.vega || 0,
        rho: option.rho || 0,
      };
    });
}

/**
 * Calculate Greeks using Black-Scholes model for NSE options
 * (since NSE doesn't provide them)
 */
function calculateBlackScholesGreeks(
  S: number,      // Spot price
  K: number,      // Strike price
  T: number,      // Time to expiration in years
  r: number,      // Risk-free rate
  sigma: number,  // Implied volatility
  type: 'C' | 'P' // Call or Put
): { delta: number; gamma: number; theta: number; vega: number } {
  if (T <= 0 || sigma <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  // Standard normal CDF
  const N = (x: number) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  };

  // Standard normal PDF
  const n = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

  // Calculate Greeks
  const delta = type === 'C' ? N(d1) : N(d1) - 1;
  const gamma = n(d1) / (S * sigma * Math.sqrt(T));
  const theta = type === 'C'
    ? (-S * n(d1) * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * N(d2)) / 365
    : (-S * n(d1) * sigma / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * N(-d2)) / 365;
  const vega = S * n(d1) * Math.sqrt(T) / 100; // divided by 100 for 1% change

  return { delta, gamma, theta, vega };
}

/**
 * Normalize NSE data to our internal format with calculated Greeks
 * Includes validation for invalid dates and data
 */
function normalizeNSEOptionData(nseData: NSEResponse, spotPrice: number): OptionData[] {
  const options: OptionData[] = [];
  const data = nseData.filtered?.data || nseData.records.data;
  const riskFreeRate = 0.065; // India risk-free rate ~6.5%

  data.forEach(strike => {
    // Validate expiration date
    if (!strike.expiryDate) {
      console.warn(`   [NSE] Skipping strike ${strike.strikePrice} - no expiry date`);
      return;
    }
    
    const expirationDate = new Date(strike.expiryDate);
    if (isNaN(expirationDate.getTime())) {
      console.warn(`   [NSE] Skipping strike ${strike.strikePrice} - invalid expiry: ${strike.expiryDate}`);
      return;
    }
    
    const now = new Date();
    const timeToExpiry = (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365);

    // Skip expired options or invalid time calculations
    if (timeToExpiry <= 0) {
      return;
    }

    // Add Call option if available
    if (strike.CE) {
      const iv = strike.CE.impliedVolatility / 100;
      const greeks = calculateBlackScholesGreeks(spotPrice, strike.strikePrice, timeToExpiry, riskFreeRate, iv, 'C');

      options.push({
        strike: strike.strikePrice,
        type: 'C',
        expiration: expirationDate,
        lastPrice: strike.CE.lastPrice,
        bid: strike.CE.bidprice,
        ask: strike.CE.askPrice,
        volume: strike.CE.totalTradedVolume || 0,
        openInterest: strike.CE.openInterest || 0,
        impliedVolatility: iv,
        delta: greeks.delta,
        gamma: greeks.gamma,
        theta: greeks.theta,
        vega: greeks.vega,
        rho: undefined, // Not critical for GEX
      });
    }

    // Add Put option if available
    if (strike.PE) {
      const iv = strike.PE.impliedVolatility / 100;
      const greeks = calculateBlackScholesGreeks(spotPrice, strike.strikePrice, timeToExpiry, riskFreeRate, iv, 'P');

      options.push({
        strike: strike.strikePrice,
        type: 'P',
        expiration: expirationDate,
        lastPrice: strike.PE.lastPrice,
        bid: strike.PE.bidprice,
        ask: strike.PE.askPrice,
        volume: strike.PE.totalTradedVolume || 0,
        openInterest: strike.PE.openInterest || 0,
        impliedVolatility: iv,
        delta: greeks.delta,
        gamma: greeks.gamma,
        theta: greeks.theta,
        vega: greeks.vega,
        rho: undefined,
      });
    }
  });

  return options;
}

/**
 * Store option chain snapshot in database
 */
async function storeOptionChainSnapshot(
  ticker: string,
  timestamp: Date,
  spotPrice: number,
  options: OptionData[],
  market: 'USA' | 'INDIA' = 'USA'
): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert snapshot metadata
    const snapshotResult = await client.query(
      `INSERT INTO option_snapshots (ticker, timestamp, spot_price, data_count, market)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [ticker, timestamp, spotPrice, options.length, market]
    );

    const snapshotId = snapshotResult.rows[0].id;

    // Bulk insert option data
    for (const option of options) {
      await client.query(
        `INSERT INTO option_data (
          snapshot_id, strike, option_type, expiration, last_price,
          bid, ask, volume, open_interest, implied_volatility,
          delta, gamma, theta, vega, rho
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          snapshotId,
          option.strike,
          option.type,
          option.expiration,
          option.lastPrice,
          option.bid,
          option.ask,
          option.volume,
          option.openInterest,
          option.impliedVolatility,
          option.delta,
          option.gamma,
          option.theta,
          option.vega,
          option.rho,
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Stored ${options.length} options for ${ticker} at ${timestamp.toISOString()}`);

    return snapshotId;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to store option chain snapshot:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main function to fetch and store option data
 * Includes 15-minute rate limiting between requests
 */
export async function fetchAndStoreOptionData(
  ticker: string,
  market?: 'USA' | 'INDIA'
): Promise<boolean> {
  try {
    console.log(`\n📊 Fetching option data for ${ticker}...`);

    // Determine market based on ticker if not specified
    const tickerMarket = market || (INDIA_TICKERS.includes(ticker) ? 'INDIA' : 'USA');
    
    let spotPrice = 0;
    let normalizedOptions: OptionData[] = [];
    const timestamp = new Date();

    if (tickerMarket === 'USA') {
      // Fetch from CBOE
      const cboeData = await fetchOptionChainFromCBOE(ticker);

      if (!cboeData || !cboeData.options || cboeData.options.length === 0) {
        console.error(`❌ No option data received for ${ticker} from CBOE`);
        return false;
      }

      spotPrice = cboeData.current_price || cboeData.price || 0;
      normalizedOptions = normalizeCBOEOptionData(cboeData.options);
      
      // Safe logging with date validation
      const validDates = normalizedOptions.filter(o => !isNaN(o.expiration.getTime()));
      const uniqueExpiries = new Set(validDates.map(o => o.expiration.toISOString().split('T')[0])).size;
      console.log(`📈 CBOE: Found ${normalizedOptions.length} options across ${uniqueExpiries} expiries`);
    } else {
      // Fetch from NSE
      const nseData = await fetchOptionChainFromNSE(ticker);

      if (!nseData || !nseData.records || !nseData.records.data || nseData.records.data.length === 0) {
        console.error(`❌ No option data received for ${ticker} from NSE`);
        return false;
      }

      spotPrice = nseData.records.underlyingValue || 0;
      normalizedOptions = normalizeNSEOptionData(nseData, spotPrice);
      
      // Safe logging with date validation
      const validDates = normalizedOptions.filter(o => !isNaN(o.expiration.getTime()));
      const uniqueExpiries = new Set(validDates.map(o => o.expiration.toISOString().split('T')[0])).size;
      console.log(`📈 NSE: Found ${normalizedOptions.length} options with calculated Greeks across ${uniqueExpiries} expiries`);
    }

    // Store in database
    await storeOptionChainSnapshot(ticker, timestamp, spotPrice, normalizedOptions, tickerMarket);

    console.log(`✅ Successfully processed ${ticker} (${tickerMarket}): ${normalizedOptions.length} options, spot: ${spotPrice}`);

    return true;
  } catch (error) {
    console.error(`❌ Error in fetchAndStoreOptionData for ${ticker}:`, error);
    return false;
  }
}

/**
 * Fetch and store data for multiple tickers with rate limiting
 * 15-minute delay between API requests to respect rate limits
 */
/**
 * Fetch and store data for multiple tickers
 * Groups tickers and fetches them sequentially with small delays within groups
 * Then waits 15 minutes before the next group
 */
export async function fetchAndStoreMultipleTickers(tickers: string[]): Promise<void> {
  console.log(`\n🚀 Starting data collection for ${tickers.length} ticker(s)...`);
  console.log(`📋 Tickers: ${tickers.join(', ')}\n`);

  // Process all tickers sequentially with small delays
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    
    console.log(`[${i + 1}/${tickers.length}] Processing ${ticker}...`);
    await fetchAndStoreOptionData(ticker);
    
    // Add a small delay between requests (5 seconds) to avoid rate limiting
    if (i < tickers.length - 1) {
      const delaySeconds = 5;
      console.log(`⏳ Waiting ${delaySeconds}s before next ticker...\n`);
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    }
  }

  console.log(`✅ Data collection completed for all tickers at ${new Date().toLocaleTimeString()}\n`);
}
