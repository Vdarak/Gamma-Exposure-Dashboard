# 🚀 Railway Deployment Checklist

## Pre-Deployment Verification

### ✅ Code Compilation

```bash
cd backend
npm run build
```

**Expected Output**: 
```
> backend@1.0.0 build
> tsc

✨ Done! No errors.
```

**Status**: ✅ COMPLETED (just verified)

---

## 🚂 Railway Setup

### Step 1: Install Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Verify installation
railway --version
```

### Step 2: Login to Railway

```bash
railway login
```

This opens your browser for authentication. Allow access.

### Step 3: Initialize Project

```bash
cd backend
railway init
```

**Questions you'll be asked**:
```
? Select a project: 
  > Create new project

? Enter project name: 
  > gamma-exposure-backend  (or your choice)

? Select a region:
  > us-west1  (choose closest to you)
```

### Step 4: Create PostgreSQL Database

```bash
railway add
```

**Select**: `PostgreSQL`

Railway will:
- Provision a PostgreSQL database
- Generate DATABASE_URL automatically
- Connect it to your project

### Step 5: Set Environment Variables

```bash
# Set one by one
railway variables set PORT=3001
railway variables set NODE_ENV=production
railway variables set US_TICKERS=SPX,GLD,TSLA
railway variables set INDIA_TICKERS=NIFTY,BANKNIFTY,RELIANCE

# Market hours (EST for US, IST for India - converted to UTC)
railway variables set US_MARKET_START_HOUR=14
railway variables set US_MARKET_START_MINUTE=30
railway variables set US_MARKET_END_HOUR=21
railway variables set US_MARKET_END_MINUTE=0

railway variables set INDIA_MARKET_START_HOUR=4
railway variables set INDIA_MARKET_START_MINUTE=0
railway variables set INDIA_MARKET_END_HOUR=10
railway variables set INDIA_MARKET_END_MINUTE=30

# Risk-free rate for Black-Scholes (adjust as needed)
railway variables set RISK_FREE_RATE=0.065
```

**Check variables**:
```bash
railway variables
```

### Step 6: Deploy!

```bash
railway up
```

**What happens**:
1. Uploads your code to Railway
2. Installs dependencies (`npm install`)
3. Runs build (`npm run build`)
4. Initializes database (runs schema.sql)
5. Starts server (`npm start`)

**Watch logs**:
```bash
railway logs
```

---

## 🔍 Post-Deployment Verification

### Step 1: Get Your URL

```bash
railway open
```

This opens your project dashboard. Look for:
```
Deployments > Latest > Domain
Example: https://gamma-exposure-backend-production-abc123.up.railway.app
```

**Save this URL** - you'll use it in your frontend!

### Step 2: Test Health Endpoint

```bash
curl https://your-railway-url.up.railway.app/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-13T15:30:00.000Z"
}
```

### Step 3: Check Database Connection

```bash
curl https://your-railway-url.up.railway.app/api/stats
```

**Expected Response**:
```json
{
  "totalSnapshots": 0,
  "tickers": [],
  "oldestSnapshot": null,
  "newestSnapshot": null,
  "averageOptionsPerSnapshot": 0
}
```

_(Initially 0 because no data collected yet)_

### Step 4: Trigger First Collection

```bash
curl -X POST https://your-railway-url.up.railway.app/api/collect-now
```

**Expected Response**:
```json
{
  "message": "Data collection triggered successfully",
  "timestamp": "2025-10-13T15:35:00.000Z"
}
```

**Watch logs for collection**:
```bash
railway logs --tail
```

**Look for**:
```
🔍 Fetching option chain for SPX...
✅ Successfully fetched SPX option chain
   - Expiries: 2025-10-13, 2025-10-18, 2025-11-15, ...
   - Total options: 2450
   - Stored snapshot ID: 1

⏳ Waiting 15 minutes before next ticker...
Next request at: 2025-10-13T15:50:00.000Z

🔍 Fetching option chain for GLD...
✅ Successfully fetched GLD option chain
   - Expiries: 2025-10-18, 2025-11-15, 2025-12-20, ...
   - Total options: 1840
   - Stored snapshot ID: 2

[NSE Collections should show calculated Greeks]
🧮 Calculated Greeks for NIFTY strike 24000:
   - Delta: 0.6523
   - Gamma: 0.0012
   - Theta: -15.34
   - Vega: 42.18
```

### Step 5: Verify Data Collection

Wait 5 minutes, then:

```bash
curl https://your-railway-url.up.railway.app/api/stats
```

**Expected Response**:
```json
{
  "totalSnapshots": 6,
  "tickers": ["SPX", "GLD", "TSLA", "NIFTY", "BANKNIFTY", "RELIANCE"],
  "oldestSnapshot": "2025-10-13T15:35:00.000Z",
  "newestSnapshot": "2025-10-13T15:35:00.000Z",
  "averageOptionsPerSnapshot": 2100
}
```

### Step 6: Test Historical API

```bash
# Get timestamps for SPX
curl "https://your-railway-url.up.railway.app/api/timestamps?ticker=SPX"

# Get data at specific timestamp (use timestamp from above)
curl "https://your-railway-url.up.railway.app/api/historical-data?ticker=SPX&timestamp=2025-10-13T15:35:00"

# Get available expiries
curl "https://your-railway-url.up.railway.app/api/expiries?ticker=SPX&timestamp=2025-10-13T15:35:00"
```

---

## 🔧 Configuration Tweaks

### Adjust Collection Interval

Edit `backend/src/server.ts`:

```typescript
// Change from '*/15' to '*/30' for 30-minute intervals
cron.schedule('*/30 * * * *', async () => {
  await collectMarketData()
})
```

Redeploy:
```bash
railway up
```

### Change Data Retention

Edit `backend/src/server.ts`:

```typescript
// Change from '0 0 *' to '0 0 */12' for cleanup twice daily
cron.schedule('0 0 */12 * * *', async () => {
  await cleanupOldData(7) // Keep 7 days instead of 3
})
```

### Add More Tickers

```bash
railway variables set US_TICKERS=SPX,GLD,TSLA,QQQ,IWM
railway variables set INDIA_TICKERS=NIFTY,BANKNIFTY,RELIANCE,FINNIFTY
```

No redeployment needed - server reads from environment.

---

## 🎨 Frontend Integration

### Update Frontend API URL

Edit `lib/data-service.ts` (or wherever you call backend):

```typescript
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 
  'https://your-railway-url.up.railway.app'

export async function getTimestamps(ticker: string) {
  const res = await fetch(`${BACKEND_URL}/api/timestamps?ticker=${ticker}`)
  return res.json()
}

export async function getHistoricalData(ticker: string, timestamp: string) {
  const res = await fetch(
    `${BACKEND_URL}/api/historical-data?ticker=${ticker}&timestamp=${timestamp}`
  )
  return res.json()
}

export async function getExpiries(ticker: string, timestamp: string) {
  const res = await fetch(
    `${BACKEND_URL}/api/expiries?ticker=${ticker}&timestamp=${timestamp}`
  )
  return res.json()
}
```

### Add to `.env.local` (Frontend)

```bash
NEXT_PUBLIC_BACKEND_URL=https://your-railway-url.up.railway.app
```

---

## 📊 Monitoring

### View Logs

```bash
# Live tail
railway logs --tail

# Last 100 lines
railway logs

# Filter by keyword
railway logs | grep "ERROR"
railway logs | grep "Calculated Greeks"
railway logs | grep "NSE"
```

### Check Resource Usage

```bash
railway status
```

**Expected (free tier)**:
```
CPU: 0.01 vCPU (< 1% of limit)
Memory: 120 MB (< 5% of 512 MB limit)
Database: 50 MB (< 1% of 5 GB limit)
```

### Database Access

```bash
# Connect to database
railway connect postgres

# Run SQL queries
SELECT COUNT(*) FROM option_snapshots;
SELECT ticker, COUNT(*) FROM option_snapshots GROUP BY ticker;
SELECT * FROM option_snapshots ORDER BY timestamp DESC LIMIT 5;
```

---

## 🐛 Troubleshooting

### Issue: Build Fails

**Error**: `Cannot find module 'pg'`

**Fix**:
```bash
cd backend
npm install
railway up
```

### Issue: Database Connection Fails

**Error**: `Error: Connection refused`

**Check**:
```bash
railway variables | grep DATABASE_URL
```

**Fix**: Ensure PostgreSQL is added:
```bash
railway add
# Select PostgreSQL
```

### Issue: NSE API Returns 401

**Error**: `NSE API failed with status: 401`

**Reason**: NSE requires cookies (already implemented!)

**Check logs**:
```bash
railway logs | grep "NSE"
```

**Should see**:
```
🍪 Fetching NSE cookies for NIFTY...
✅ Got NSE cookies
🔍 Fetching option chain for NIFTY...
✅ Successfully fetched NIFTY option chain
🧮 Calculated Greeks for NIFTY...
```

### Issue: No 0DTE Data for SPX

**Reason**: Market closed or non-trading day

**Check**: Only run on weekdays during market hours (9:30 AM - 4:00 PM EST)

**Manual test**:
```bash
# Only works during market hours
curl -X POST https://your-railway-url.up.railway.app/api/collect-now
```

### Issue: High Resource Usage

**If CPU > 50%**:
- Increase collection interval (30 min instead of 15 min)
- Reduce number of tickers

**If Memory > 300 MB**:
- Railway free tier is 512 MB, you're fine!
- Can upgrade if needed ($5/month)

**If Database > 1 GB**:
- Reduce retention (1 day instead of 3 days)
- Clean manually:
  ```sql
  DELETE FROM option_snapshots WHERE timestamp < NOW() - INTERVAL '1 day';
  ```

---

## 🚀 Success Checklist

After deployment, verify:

- ✅ Health endpoint returns `200 OK`
- ✅ Stats show data for all 6 tickers
- ✅ Logs show "Calculated Greeks" for NSE tickers
- ✅ Logs show "Waiting 15 minutes" between tickers
- ✅ 0DTE options appear in SPX data (during market hours)
- ✅ Timestamps API returns multiple snapshots
- ✅ Historical data API returns complete option chains
- ✅ Expiries API returns correct expiry dates
- ✅ Frontend can connect and display Time Machine

**You're live! 🎉**

---

## 📈 Next Steps

1. **Test Time Machine UI**: Connect `enhanced-time-machine.tsx` to your Railway backend
2. **Add Price Charts**: Use TradingView Lightweight Charts (see `FREE-CHART-OPTIONS.md`)
3. **Monitor Collections**: Watch logs for first few days to ensure stability
4. **Analyze Data**: Start exploring GEX patterns across time and expiries!

---

## 🆘 Support

**Railway Docs**: https://docs.railway.app/  
**Railway Community**: https://discord.gg/railway  

**Common Railway Commands**:
```bash
railway status          # Check deployment status
railway logs           # View logs
railway open           # Open dashboard
railway variables      # List environment variables
railway restart        # Restart service
railway down           # Delete deployment
```

**Your Backend is Ready to Go! 🚂**
