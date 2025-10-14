# 🚂 Railway Dashboard Setup Guide

Your Railway project has been created but needs proper configuration in the dashboard.

## Current Status

✅ Railway project created: "gamma exposure dashboard"  
✅ PostgreSQL database added  
✅ Code uploaded and built successfully  
✅ schema.sql file fix applied  
❌ App service needs DATABASE_URL connection

## 🔧 Steps to Complete Setup

### Step 1: Open Railway Dashboard

The dashboard should already be open. If not:
```bash
railway open
```

URL: https://railway.com/project/fb5fa6e7-aed6-42a2-9ea1-d1202fee3ecd

### Step 2: Create New Service for Backend

1. Click **"+ New"** button in the top right
2. Select **"Empty Service"**
3. Name it: `backend-api`

### Step 3: Link Your Code to the Service

1. Click on the new `backend-api` service
2. Go to **"Settings"** tab
3. Scroll to **"Source"** section
4. Click **"Connect Repo"**
5. Select **"Local Directory"** (if available) or we'll use CLI

**OR** use CLI:
```bash
railway service backend-api
railway up
```

### Step 4: Add Reference to PostgreSQL

1. Still in `backend-api` service
2. Go to **"Variables"** tab
3. Click **"+ New Variable"** → **"Add Reference"**
4. Select: `Postgres` → `DATABASE_URL`
5. This creates: `${{Postgres.DATABASE_URL}}`

### Step 5: Add Environment Variables

In the same **"Variables"** tab, add these:

```
PORT=3001
NODE_ENV=production
US_TICKERS=SPX,GLD,TSLA
INDIA_TICKERS=NIFTY,BANKNIFTY,RELIANCE
US_MARKET_START_HOUR=14
US_MARKET_START_MINUTE=30
US_MARKET_END_HOUR=21
US_MARKET_END_MINUTE=0
INDIA_MARKET_START_HOUR=4
INDIA_MARKET_START_MINUTE=0
INDIA_MARKET_END_HOUR=10
INDIA_MARKET_END_MINUTE=30
RISK_FREE_RATE=0.065
```

### Step 6: Generate Domain

1. Go to **"Settings"** tab
2. Scroll to **"Networking"** section
3. Click **"Generate Domain"**
4. Copy the URL (e.g., `backend-api-production.up.railway.app`)

### Step 7: Redeploy

1. Click **"Deploy"** button
2. Or use CLI: `railway up`

---

## 🎯 Alternative: CLI Method (Recommended)

Since we've already uploaded the code, let's properly link everything:

### 1. Unlink from Postgres

```bash
cd backend
railway unlink
```

### 2. Re-link and Select Proper Service

```bash
railway link
# Select: gamma exposure dashboard
# Select: production
# SKIP service selection (press ESC)
```

### 3. Create and Link New Service

```bash
# This will create a new service from your code
railway up --service backend-api
```

If it asks to create a service, say YES.

### 4: Add Database Reference via CLI

Unfortunately, database references must be added via dashboard. So:

```bash
railway open
```

Then in dashboard:
1. Click `backend-api` service
2. Variables tab
3. Add Reference → Postgres → DATABASE_URL

### 5. Set All Environment Variables

```bash
railway variables --service backend-api \
  --set "PORT=3001" \
  --set "NODE_ENV=production" \
  --set "US_TICKERS=SPX,GLD,TSLA" \
  --set "INDIA_TICKERS=NIFTY,BANKNIFTY,RELIANCE" \
  --set "US_MARKET_START_HOUR=14" \
  --set "US_MARKET_START_MINUTE=30" \
  --set "US_MARKET_END_HOUR=21" \
  --set "US_MARKET_END_MINUTE=0" \
  --set "INDIA_MARKET_START_HOUR=4" \
  --set "INDIA_MARKET_START_MINUTE=0" \
  --set "INDIA_MARKET_END_HOUR=10" \
  --set "INDIA_MARKET_END_MINUTE=30" \
  --set "RISK_FREE_RATE=0.065"
```

---

## ✅ Verification Steps

Once deployed, check:

### 1. View Logs
```bash
railway logs --service backend-api
```

**Look for:**
```
✅ Database initialized successfully
🚀 Server running on port 3001
⏰ Cron job scheduled
```

### 2. Get Your URL
```bash
railway status --service backend-api
```

### 3. Test Health Endpoint
```bash
curl https://your-url.up.railway.app/health
```

**Expected:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-13T..."
}
```

---

## 🐛 Troubleshooting

### If DATABASE_URL is Missing

**Error:** `ECONNREFUSED` or `ENETUNREACH`

**Fix:** Add database reference in dashboard:
1. backend-api → Variables
2. New Variable → Reference → Postgres → DATABASE_URL

### If Service Not Found

```bash
railway service
# Select: backend-api (create if doesn't exist)
```

### If Variables Not Set

Check in dashboard:
1. backend-api → Variables tab
2. Should see DATABASE_URL (from Postgres reference)
3. Should see all other environment variables

### If Build Fails

```bash
# Rebuild locally first
npm run build

# Then deploy
railway up --service backend-api
```

---

## 📞 Need Help?

Current project: https://railway.com/project/fb5fa6e7-aed6-42a2-9ea1-d1202fee3ecd

The easiest path forward is:
1. Open dashboard: `railway open`
2. Create new service: backend-api
3. Link it to your uploaded code
4. Add DATABASE_URL reference
5. Add environment variables
6. Generate domain
7. Deploy!

**I recommend using the dashboard method for this initial setup!**
