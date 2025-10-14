# Railway Deployment Guide

## Step-by-Step Deployment Instructions

### 1. Login to Railway

```bash
railway login
```

This will open your browser to authenticate with Railway.

### 2. Initialize Railway Project

```bash
cd backend
railway init
```

- Choose "Create new project"
- Give it a name like "gamma-exposure-backend"

### 3. Add PostgreSQL Database

**Option A: Via CLI**
```bash
railway add --database postgres
```

**Option B: Via Dashboard (Recommended)**
1. Go to https://railway.app/dashboard
2. Select your project
3. Click "+ New" → "Database" → "Add PostgreSQL"
4. Railway will automatically set the `DATABASE_URL` environment variable

### 4. Set Environment Variables

In the Railway dashboard:
1. Go to your project
2. Click on your service
3. Go to "Variables" tab
4. Add the following variables:

```
NODE_ENV=production
FRONTEND_URL=https://your-frontend-url.vercel.app
TICKERS=SPX,QQQ
COLLECT_INTERVAL_MINUTES=15
DATA_RETENTION_DAYS=3
MARKET_START_HOUR=9
MARKET_END_HOUR=16
```

> **Note**: `DATABASE_URL` is automatically set by Railway when you add PostgreSQL

### 5. Deploy Your Backend

```bash
railway up
```

Or set up GitHub deployment (recommended):
1. Push your backend code to GitHub
2. In Railway dashboard, click "Settings"
3. Connect GitHub repository
4. Select the `backend` folder as the root directory
5. Railway will auto-deploy on every push!

### 6. Get Your Backend URL

After deployment:
```bash
railway domain
```

Or in the dashboard:
1. Go to your service
2. Click "Settings"
3. Under "Domains", click "Generate Domain"
4. Copy the URL (e.g., `https://your-backend.up.railway.app`)

### 7. Update Frontend Configuration

Update your frontend code to use the Railway backend URL:

```typescript
// In your dashboard component or config file
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'
```

Add to your frontend `.env.local`:
```
NEXT_PUBLIC_BACKEND_URL=https://your-backend.up.railway.app
```

### 8. Verify Deployment

Test your endpoints:

```bash
# Health check
curl https://your-backend.up.railway.app/health

# Check stats
curl https://your-backend.up.railway.app/api/stats

# Trigger manual collection
curl -X POST https://your-backend.up.railway.app/api/collect-now
```

### 9. Monitor Your Application

Railway Dashboard provides:
- ✅ Real-time logs
- ✅ Resource usage metrics
- ✅ Deployment history
- ✅ Database metrics

View logs:
```bash
railway logs
```

## Troubleshooting

### Database Connection Issues

If you see connection errors:

1. Check DATABASE_URL is set:
```bash
railway variables
```

2. Verify PostgreSQL is running:
```bash
railway ps
```

3. Check logs for specific errors:
```bash
railway logs --tail
```

### Cron Jobs Not Running

Ensure your server is not sleeping:
1. Railway free tier keeps services running
2. Check logs for cron schedule confirmation
3. Verify market hours are correct for your timezone

### Out of Memory Errors

If the service crashes due to memory:
1. Railway free tier has 512MB memory
2. Optimize your database queries
3. Consider upgrading to a paid plan if needed

### CORS Errors

If frontend can't connect:
1. Verify `FRONTEND_URL` environment variable is set correctly
2. Include `https://` in the URL
3. Check Railway logs for CORS-related errors

## Cost Monitoring

Railway provides a cost estimator:
- Free tier: $5/month credit (500 execution hours)
- Your backend uses ~360 minutes/month
- **Estimated cost: $0/month** (well within free tier!)

Monitor usage:
1. Go to Railway dashboard
2. Click on your project
3. View "Usage" tab

## Updating Your Deployment

### Method 1: Manual Deploy
```bash
cd backend
git pull  # Get latest changes
railway up
```

### Method 2: Auto-Deploy (GitHub)
Just push to your repository:
```bash
git add .
git commit -m "Update backend"
git push origin main
```

Railway will automatically detect changes and redeploy!

## Scaling Considerations

As your usage grows:

### Add More Tickers
Update `TICKERS` environment variable:
```
TICKERS=SPX,QQQ,NDX,RUT,AAPL,TSLA
```

### Adjust Collection Frequency
For less frequent updates (save resources):
```
COLLECT_INTERVAL_MINUTES=30
```

For more frequent updates:
```
COLLECT_INTERVAL_MINUTES=5
```

### Extend Data Retention
Store more historical data:
```
DATA_RETENTION_DAYS=7
```

## Security Best Practices

1. **Never commit `.env` files**
   - Already in `.gitignore`
   - Set variables in Railway dashboard

2. **Use environment variables for sensitive data**
   - API keys
   - Database credentials

3. **Enable Railway's automatic HTTPS**
   - Provided by default

4. **Regular backups**
   - Railway provides automatic database backups
   - Consider exporting data periodically

## Support

If you encounter issues:

1. Check Railway documentation: https://docs.railway.app
2. View Railway logs: `railway logs --tail`
3. Check Railway status: https://status.railway.app
4. Community help: https://discord.gg/railway

## Next Steps

After deployment:

✅ Backend is collecting data automatically
✅ Database is storing historical snapshots
✅ API endpoints are accessible
✅ Ready to integrate with frontend Time Machine!

Now go to your frontend and:
1. Add the Time Machine component
2. Update API calls to use backend URL
3. Test the time-travel feature!

Happy deploying! 🚀
