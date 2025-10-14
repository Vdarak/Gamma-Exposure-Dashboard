# 🚀 Quick Start Guide - Gamma Exposure Backend & Time Machine

## What You Just Built

✅ **Backend Server** - Automatically collects option chain data every 15 minutes  
✅ **PostgreSQL Database** - Stores 2-3 days of historical data  
✅ **RESTful API** - Endpoints for current and historical data  
✅ **Time Machine Component** - Interactive UI to travel through time  
✅ **Railway Deployment** - Free hosting ready to go  

---

## 🎯 Next Steps

### Step 1: Deploy Backend to Railway (5 minutes)

```bash
# 1. Login to Railway
railway login

# 2. Navigate to backend folder
cd backend

# 3. Initialize Railway project
railway init
# Choose: "Create new project"
# Name: "gamma-exposure-backend"

# 4. Add PostgreSQL database
railway add
# Choose: "PostgreSQL"

# 5. Deploy!
railway up
```

### Step 2: Get Your Backend URL

```bash
# Generate a public domain
railway domain
```

Copy the URL (e.g., `https://gamma-exposure-backend-production.up.railway.app`)

### Step 3: Configure Environment Variables in Railway

Go to Railway dashboard → Your Project → Variables

Add these:
```
NODE_ENV=production
FRONTEND_URL=https://your-frontend-url.vercel.app
TICKERS=SPX,QQQ
COLLECT_INTERVAL_MINUTES=15
DATA_RETENTION_DAYS=3
```

### Step 4: Update Your Frontend

Create `.env.local` in your project root:
```bash
NEXT_PUBLIC_BACKEND_URL=https://your-backend.up.railway.app
```

### Step 5: Add Time Machine to Your Dashboard

Option A: Use the example integration file:
```typescript
// Copy components/example-integration.tsx to app/page.tsx
// Or integrate parts of it into your existing dashboard
```

Option B: Minimal integration:
```typescript
import { TimeMachine } from '@/components/time-machine'

export default function YourPage() {
  const [selectedTimestamp, setSelectedTimestamp] = useState<Date | null>(null)
  
  return (
    <>
      <TimeMachine
        ticker="SPX"
        onTimestampChange={setSelectedTimestamp}
      />
      {/* Your existing components */}
    </>
  )
}
```

---

## 🧪 Testing Locally

### 1. Set Up Local PostgreSQL (Optional for local dev)

**Option A: Use Railway Database Locally**
```bash
cd backend
railway run npm run dev
# This uses Railway's database even locally
```

**Option B: Use Local PostgreSQL**
```bash
# Install PostgreSQL (macOS)
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb gamma_options

# Update backend/.env
DATABASE_URL=postgresql://localhost:5432/gamma_options

# Run backend
cd backend
npm run dev
```

### 2. Test the Backend

```bash
# Health check
curl http://localhost:3001/health

# Trigger manual data collection
curl -X POST http://localhost:3001/api/collect-now

# Check stats
curl http://localhost:3001/api/stats

# Get current data
curl http://localhost:3001/api/current-data?ticker=SPX

# Get timestamps
curl http://localhost:3001/api/timestamps?ticker=SPX
```

### 3. Run Your Frontend

```bash
# In another terminal, from project root
npm run dev
```

Visit `http://localhost:3000` and you should see the Time Machine component!

---

## 📊 How It Works

### Data Collection Flow

```
Every 15 minutes (during market hours):
  1. Backend wakes up via cron job
  2. Fetches option chain from CBOE API
  3. Stores snapshot in PostgreSQL
  4. Cleans up data older than 3 days
  5. Goes back to sleep
```

### Time Machine Flow

```
User interacts with Time Machine:
  1. Frontend requests available timestamps
  2. User drags slider to specific time
  3. Frontend requests historical data at that timestamp
  4. Backend finds closest snapshot
  5. Frontend displays historical GEX data
```

### Database Structure

```sql
option_snapshots (metadata)
├── id
├── ticker
├── timestamp
├── spot_price
└── data_count

option_data (details)
├── id
├── snapshot_id (references option_snapshots)
├── strike
├── option_type (C/P)
├── expiration
├── greeks (delta, gamma, theta, vega, rho)
└── market data (price, volume, OI, IV)
```

---

## 🎨 Customization

### Change Collection Frequency

In Railway dashboard or `.env`:
```
COLLECT_INTERVAL_MINUTES=30  # Collect every 30 mins
```

### Add More Tickers

```
TICKERS=SPX,QQQ,NDX,RUT,AAPL,TSLA
```

### Extend Data Retention

```
DATA_RETENTION_DAYS=7  # Keep 7 days of data
```

### Adjust Market Hours

```
MARKET_START_HOUR=9   # 9 AM
MARKET_END_HOUR=16    # 4 PM
```

---

## 🐛 Troubleshooting

### Backend won't start

**Check logs:**
```bash
railway logs --tail
```

**Common issues:**
- Missing DATABASE_URL → Make sure PostgreSQL is added
- Port already in use → Change PORT in .env
- Database connection failed → Check DATABASE_URL format

### Time Machine shows "No data available"

**Solution:**
1. Wait 15 minutes for first collection
2. Or manually trigger: `curl -X POST http://localhost:3001/api/collect-now`
3. Check backend logs for errors

### CORS errors in browser

**Solution:**
Update `FRONTEND_URL` in Railway dashboard to match your frontend URL (with https://)

### Data not appearing in frontend

**Check:**
1. Backend URL is correct in `.env.local`
2. Backend is running: `curl https://your-backend.up.railway.app/health`
3. Data exists: `curl https://your-backend.up.railway.app/api/stats`

---

## 📈 Monitoring

### View Logs
```bash
railway logs --tail
```

### Check Database
```bash
railway connect postgres
\dt  # List tables
SELECT COUNT(*) FROM option_snapshots;
SELECT * FROM option_snapshots ORDER BY timestamp DESC LIMIT 5;
```

### Monitor Usage
Railway Dashboard → Your Project → Usage tab

---

## 💰 Cost Breakdown

**Railway Free Tier:**
- 500 hours of execution/month
- $5 credit/month

**Your Usage:**
- Cron runs: 96 times/day × 30 days = 2,880 runs/month
- Runtime per run: ~30 seconds
- Total: 2,880 × 0.5 min = 1,440 minutes = 24 hours

**Cost: $0/month** (Only 4.8% of free tier!) ✅

---

## 🎓 Learning Resources

- Railway Docs: https://docs.railway.app
- PostgreSQL Tutorial: https://www.postgresqltutorial.com
- Node-cron: https://github.com/node-cron/node-cron
- Options Data: https://www.cboe.com/delayed_quotes

---

## 🚦 Checklist

- [ ] Backend deployed to Railway
- [ ] PostgreSQL database added
- [ ] Environment variables configured
- [ ] Backend URL added to frontend `.env.local`
- [ ] Time Machine component integrated
- [ ] First data collection completed
- [ ] Frontend can fetch historical data
- [ ] Time travel works! 🎉

---

## 🎉 You're Done!

Your automated option data collection system is now running!

**What happens next:**
1. ✅ Backend collects data every 15 minutes automatically
2. ✅ Database stores snapshots with full option chain
3. ✅ Time Machine lets you travel through time
4. ✅ You can analyze how GEX changed over time
5. ✅ All running for FREE on Railway!

**Cool things you can build now:**
- Compare GEX at market open vs close
- Identify persistent support/resistance levels
- Track gamma flip level changes
- Analyze pre/post major news events
- Build alerts for unusual GEX movements

---

Need help? Check:
- `backend/README.md` - Detailed backend docs
- `backend/DEPLOYMENT.md` - Deployment guide
- `components/example-integration.tsx` - Integration examples

**Happy trading! 📊🚀**
