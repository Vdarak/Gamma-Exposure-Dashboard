# Gamma Exposure Backend

Automated data collection service for option chain data with historical storage and time-machine capabilities.

## Features

- 🔄 Automated data collection every 15 minutes
- 📊 Stores 2-3 days of historical option chain data
- ⏰ Scheduled cron jobs for market hours
- 🗄️ PostgreSQL database with optimized queries
- 🚀 RESTful API for frontend integration
- 🎯 Time-machine feature support

## Prerequisites

- Node.js 18.x or higher
- PostgreSQL database
- Railway account (for deployment)

## Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | Server port | 3001 |
| `FRONTEND_URL` | Frontend URL for CORS | http://localhost:3000 |
| `TICKERS` | Comma-separated list of tickers | SPX |
| `COLLECT_INTERVAL_MINUTES` | Data collection interval | 15 |
| `DATA_RETENTION_DAYS` | Days to keep historical data | 3 |

## API Endpoints

### GET `/health`
Health check endpoint
```json
{
  "status": "ok",
  "timestamp": "2025-10-13T12:00:00.000Z",
  "uptime": 1234.56
}
```

### GET `/api/current-data?ticker=SPX`
Get the most recent snapshot for a ticker
```json
{
  "success": true,
  "data": {
    "ticker": "SPX",
    "timestamp": "2025-10-13T12:00:00.000Z",
    "spotPrice": 5850.25,
    "options": [...]
  }
}
```

### GET `/api/historical-data?ticker=SPX&hoursBack=24`
Get historical snapshots
- Query params: `ticker`, `hoursBack`, `startDate`, `endDate`, `timestamp`

### GET `/api/timestamps?ticker=SPX&days=3`
Get all available timestamps for time-machine slider

### GET `/api/stats?ticker=SPX`
Get database statistics

### POST `/api/collect-now`
Manually trigger data collection (useful for testing)

## Database Schema

### `option_snapshots`
Stores metadata for each data collection
- `id`, `ticker`, `timestamp`, `spot_price`, `data_count`, `market`

### `option_data`
Stores individual option details
- `id`, `snapshot_id`, `strike`, `option_type`, `expiration`
- `last_price`, `bid`, `ask`, `volume`, `open_interest`
- `implied_volatility`, `delta`, `gamma`, `theta`, `vega`, `rho`

## Deployment to Railway

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway:**
   ```bash
   railway login
   ```

3. **Initialize project:**
   ```bash
   railway init
   ```

4. **Add PostgreSQL:**
   - Go to Railway dashboard
   - Click "New" → "Database" → "PostgreSQL"
   - Railway will auto-set `DATABASE_URL`

5. **Deploy:**
   ```bash
   railway up
   ```

6. **Set environment variables in Railway dashboard:**
   - `FRONTEND_URL` = your deployed frontend URL
   - `TICKERS` = SPX,QQQ (or your preferred tickers)
   - Other variables as needed

## Scheduled Tasks

- **Data Collection**: Every 15 minutes during market hours (Mon-Fri, 9 AM - 4 PM)
- **Cleanup**: Daily at 2 AM, removes data older than configured retention period

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run watch` - Watch mode for TypeScript compilation

## Architecture

```
backend/
├── src/
│   ├── server.ts              # Main Express server
│   ├── db/
│   │   ├── connection.ts      # PostgreSQL connection pool
│   │   ├── schema.sql         # Database schema
│   │   └── init.ts            # Database initialization
│   ├── services/
│   │   ├── dataCollector.ts   # Fetch & store data
│   │   └── dataRetrieval.ts   # Query historical data
│   └── types/
│       └── index.ts           # TypeScript types
├── dist/                      # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── railway.json               # Railway configuration
```

## Cost Estimate

**Railway Free Tier:**
- 500 hours of execution per month
- Your usage: ~360 minutes/month (< 1% of free tier!)
- **Total cost: $0/month** ✅

## Troubleshooting

### Database connection fails
```bash
# Check if DATABASE_URL is set
echo $DATABASE_URL

# Test connection manually
psql $DATABASE_URL
```

### Cron job not running
Check server logs for cron schedule confirmation

### API returns 404
Ensure data collection has run at least once

## License

MIT
