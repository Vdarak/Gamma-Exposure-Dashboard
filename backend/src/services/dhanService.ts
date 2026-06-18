import axios from 'axios';
import { OptionData } from '../types';

/**
 * Dhan API Service client
 * Docs: https://api.dhan.co/
 */
export class DhanService {
  private clientId: string;
  private accessToken: string;
  private isConfigured: boolean = false;

  constructor() {
    this.clientId = process.env.DHAN_CLIENT_ID || '';
    this.accessToken = process.env.DHAN_ACCESS_TOKEN || '';
    if (this.clientId && this.accessToken) {
      this.isConfigured = true;
    }
  }

  /**
   * Check if credentials are set
   */
  public isEnabled(): boolean {
    return this.isConfigured;
  }

  /**
   * Fetch option chain for a given symbol
   * Labeled legally as official Dhan API call
   */
  public async fetchOptionChain(symbol: string): Promise<OptionData[]> {
    if (!this.isConfigured) {
      throw new Error('Dhan API credentials are not configured in environment variables.');
    }

    try {
      console.log(`[Dhan API] Fetching option chain for ${symbol}...`);
      
      // Dhan API Endpoint for Market Feed / Option Chain
      // Note: Typically you need to resolve Dhan Security ID for the ticker first, then fetch options
      // Example request structure for Dhan Market Feed APIs:
      const response = await axios.post(
        'https://api.dhan.co/v2/marketfeed/chain',
        {
          underlying: symbol,
          expiryCount: 1, // Get nearest expiry
        },
        {
          headers: {
            'access-token': this.accessToken,
            'client-id': this.clientId,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (response.status !== 200 || !response.data) {
        throw new Error(`Dhan API returned status ${response.status}`);
      }

      // Parse and map Dhan options data format to our standard internal OptionData format
      const dhanOptions = response.data.data || [];
      const normalizedOptions: OptionData[] = dhanOptions.map((opt: any) => {
        return {
          strike: parseFloat(opt.strikePrice),
          type: opt.optionType === 'CALL' ? 'C' : 'P',
          expiration: new Date(opt.expiryDate),
          lastPrice: parseFloat(opt.lastPrice || 0),
          bid: parseFloat(opt.bidPrice || 0),
          ask: parseFloat(opt.askPrice || 0),
          volume: parseInt(opt.volume || 0),
          openInterest: parseInt(opt.openInterest || 0),
          impliedVolatility: parseFloat(opt.impliedVolatility || 0) / 100,
          changeInOi: parseInt(opt.oiChange || 0),
          totalBuyQty: parseInt(opt.totalBuyQty || 0),
          totalSellQty: parseInt(opt.totalSellQty || 0),
        };
      });

      console.log(`[Dhan API] Successfully retrieved ${normalizedOptions.length} option contracts for ${symbol}`);
      return normalizedOptions;
    } catch (error: any) {
      console.error(`[Dhan API] Error fetching options chain for ${symbol}:`, error.message);
      throw error;
    }
  }
}
