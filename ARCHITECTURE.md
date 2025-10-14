# System Architecture

## Overview

This system enables automated collection of option chain data with a time-machine feature for historical analysis.

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Time Machine Component                  │  │
│  │  • Slider for time travel                                 │  │
│  │  • Play/Pause functionality                               │  │
│  │  • Live/Historical toggle                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Gamma Exposure Visualizations                │  │
│  │  • GEX by Strike Chart                                    │  │
│  │  • Call/Put Walls                                         │  │
│  │  • Gamma Ramp                                             │  │
│  │  • Expected Move                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP Requests
                       │ (REST API)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Node.js + Express)                  │
│                        Railway Deployment                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     API Routes                            │  │
│  │  GET  /api/current-data?ticker=SPX                        │  │
│  │  GET  /api/historical-data?ticker=SPX&timestamp=...       │  │
│  │  GET  /api/timestamps?ticker=SPX                          │  │
│  │  GET  /api/stats                                          │  │
│  │  POST /api/collect-now                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Scheduled Tasks (node-cron)              │  │
│  │  • Data Collection: Every 15 minutes (market hours)       │  │
│  │  • Cleanup: Daily at 2 AM                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     Services                              │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  dataCollector.ts                                   │  │  │
│  │  │  • Fetch from CBOE API                              │  │  │
│  │  │  • Normalize data format                            │  │  │
│  │  │  • Store in database                                │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  dataRetrieval.ts                                   │  │  │
│  │  │  • Query historical data                            │  │  │
│  │  │  • Find closest timestamp                           │  │  │
│  │  │  • Get available timestamps                         │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────────┘
                       │ SQL Queries
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATABASE (PostgreSQL)                      │
│                        Railway PostgreSQL                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  option_snapshots                                         │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ id | ticker | timestamp | spot_price | data_count  │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │ 1  | SPX    | 2025-10... | 5850.25   | 2450        │  │  │
│  │  │ 2  | SPX    | 2025-10... | 5852.10   | 2448        │  │  │
│  │  │ ...                                                 │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  option_data                                              │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ id | snapshot_id | strike | type | expiration |... │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │ 1  | 1           | 5800   | C    | 2025-10-20 |... │  │  │
│  │  │ 2  | 1           | 5800   | P    | 2025-10-20 |... │  │  │
│  │  │ 3  | 1           | 5825   | C    | 2025-10-20 |... │  │  │
│  │  │ ...                                                 │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Retention Policy
                       │ (Auto-delete after 3 days)
                       ▼
                   [Cleanup Service]
```

## Data Flow

### 1. Automated Data Collection

```
┌─────────────┐
│  Cron Job   │  Every 15 minutes (market hours)
│  Scheduler  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  CBOE API       │  https://cdn.cboe.com/api/global/delayed_quotes/options/
│  Request        │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Parse & Store  │  • Normalize data format
│  in Database    │  • Insert snapshot metadata
└──────┬──────────┘  • Bulk insert option data
       │
       ▼
┌─────────────────┐
│  PostgreSQL     │  • option_snapshots (1 row)
│  Database       │  • option_data (~2,000 rows per snapshot)
└─────────────────┘
```

### 2. Time Machine Query Flow

```
┌──────────────────┐
│  User Drags      │
│  Slider          │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│  Frontend Requests       │  GET /api/historical-data
│  Historical Data         │  ?ticker=SPX&timestamp=2025-10-13T10:30:00Z
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│  Backend Queries DB      │  SELECT * FROM option_snapshots
│  for Closest Timestamp   │  WHERE ticker = 'SPX'
└────────┬─────────────────┘  ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - $1)))
         │
         ▼
┌──────────────────────────┐
│  Return Historical       │  {
│  Snapshot with Options   │    timestamp: "2025-10-13T10:30:00Z",
└────────┬─────────────────┘    spotPrice: 5850.25,
         │                      options: [...]
         ▼                    }
┌──────────────────────────┐
│  Frontend Visualizes     │
│  Historical GEX Data     │
└──────────────────────────┘
```

### 3. Live vs Historical Mode

```
┌─────────────────┐
│   User Action   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐  ┌─────────────┐
│  Live  │  │ Historical  │
│  Mode  │  │    Mode     │
└───┬────┘  └──────┬──────┘
    │              │
    ▼              ▼
┌────────────┐  ┌──────────────────┐
│ Get Latest │  │ Get Data at      │
│ Snapshot   │  │ Specific Time    │
└─────┬──────┘  └────────┬─────────┘
      │                  │
      ▼                  ▼
┌─────────────────────────────────┐
│     Display in Dashboard        │
└─────────────────────────────────┘
```

## Component Architecture

### Frontend Components

```
components/
├── time-machine.tsx
│   ├── Slider control
│   ├── Play/Pause buttons
│   ├── Live toggle
│   └── Timestamp display
│
├── gamma-exposure-dashboard.tsx
│   ├── Main dashboard container
│   └── Passes data to child charts
│
└── charts/
    ├── gex-by-strike-chart.tsx
    ├── call-put-walls-chart.tsx
    ├── gamma-ramp-chart.tsx
    └── expected-move-chart.tsx
```

### Backend Services

```
backend/src/
├── server.ts
│   ├── Express app setup
│   ├── API routes
│   └── Cron job scheduling
│
├── db/
│   ├── connection.ts (PostgreSQL pool)
│   ├── schema.sql (Database structure)
│   └── init.ts (Initialization)
│
└── services/
    ├── dataCollector.ts
    │   ├── fetchOptionChainFromCBOE()
    │   ├── normalizeOptionData()
    │   └── storeOptionChainSnapshot()
    │
    └── dataRetrieval.ts
        ├── getCurrentData()
        ├── getHistoricalData()
        ├── getDataAtTimestamp()
        └── getAvailableTimestamps()
```

## Database Schema Details

### Relationships

```
option_snapshots (1) ──────┐
                           │
                           │ 1:Many
                           │
                           └──────> option_data (Many)
```

### Indexes

```
option_snapshots:
├── PRIMARY KEY (id)
├── INDEX (ticker, timestamp DESC)  ← Fast time-range queries
├── INDEX (timestamp DESC)          ← Fast latest snapshot queries
└── INDEX (ticker)                  ← Fast ticker filtering

option_data:
├── PRIMARY KEY (id)
├── FOREIGN KEY (snapshot_id) → option_snapshots(id)
├── INDEX (snapshot_id)             ← Fast join queries
├── INDEX (strike)                  ← Fast strike filtering
├── INDEX (expiration)              ← Fast expiration filtering
└── INDEX (option_type)             ← Fast call/put filtering
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Railway Platform                     │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │          Backend Service Container                │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  Node.js 18 Runtime                          │ │ │
│  │  │  ├── Express Server (Port 3001)              │ │ │
│  │  │  ├── Cron Jobs (Background)                  │ │ │
│  │  │  └── API Handlers                            │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  │                       ↕                           │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  PostgreSQL Database                         │ │ │
│  │  │  ├── 2-3 days of data (~300 snapshots)       │ │ │
│  │  │  ├── ~600,000 option records                 │ │ │
│  │  │  └── Automatic backups                       │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  Public URL: https://your-backend.up.railway.app        │
└─────────────────────────────────────────────────────────┘
                          ↕
                   HTTPS/JSON
                          ↕
┌─────────────────────────────────────────────────────────┐
│                    Vercel Platform                      │
│  ┌───────────────────────────────────────────────────┐ │
│  │          Next.js Frontend                         │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  React Components                            │ │ │
│  │  │  ├── Time Machine                            │ │ │
│  │  │  ├── GEX Visualizations                      │ │ │
│  │  │  └── Interactive Charts                      │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  Public URL: https://your-frontend.vercel.app           │
└─────────────────────────────────────────────────────────┘
                          ↕
                    User Browser
```

## Scaling Considerations

### Current Setup (Free Tier)
- **Frequency**: 15 minutes
- **Tickers**: 1-3 tickers
- **Retention**: 3 days
- **Cost**: $0/month ✅

### Light Scaling (Still Free)
- **Frequency**: 10 minutes
- **Tickers**: 5-10 tickers
- **Retention**: 5 days
- **Cost**: $0/month ✅

### Heavy Scaling (Paid Required)
- **Frequency**: 1 minute
- **Tickers**: 50+ tickers
- **Retention**: 30 days
- **Cost**: ~$20-40/month

### Optimization Strategies
1. **Database**: Add materialized views for common queries
2. **Caching**: Redis layer for frequently accessed data
3. **CDN**: CloudFlare for static content
4. **Compression**: Gzip API responses
5. **Indexing**: Additional composite indexes

## Security

### Current Implementation
- ✅ CORS enabled with whitelist
- ✅ Environment variables for secrets
- ✅ PostgreSQL SSL in production
- ✅ Rate limiting via Railway
- ✅ HTTPS by default

### Future Enhancements
- [ ] API key authentication
- [ ] Rate limiting per client
- [ ] Request validation middleware
- [ ] Database encryption at rest
- [ ] Audit logging

---

This architecture provides a solid foundation for automated option data collection with room to scale as your needs grow!
