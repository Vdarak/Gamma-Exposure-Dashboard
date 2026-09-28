# AWS EC2 (Mumbai `ap-south-1`) Backend Deployment Guide

This guide walks through deploying the Python FastAPI backend on **AWS Free Tier** in the **Mumbai (`ap-south-1`) region** and connecting it to your **Vercel** frontend.

---

## Why AWS Mumbai (`ap-south-1`) is Required for Indian Markets

1. **Broker API Whitelisting & Stability**:
   - DhanHQ and NSE servers detect the originating geographic IP.
   - Foreign clouds (Railway in US/EU, Render, DigitalOcean US, Vercel Edge) frequently experience rate-limits, WAF challenges, or temporary blocks.
   - An AWS instance in Mumbai provides a native Indian IP.
2. **Sub-15ms Latency**:
   - Direct peering to the National Stock Exchange (NSE) and broker infrastructure.
3. **AWS Free Tier Eligible**:
   - `t3.micro` / `t2.micro` instances are 100% free (750 hours/month) for 12 months.
   - 30 GB of gp3 EBS SSD storage is included free.

---

## Architecture

```
  [ Vercel Frontend ]
  (https://gamma-exposure-dashboard.vercel.app)
          │
          │ HTTPS (Direct or via Cloudflare Tunnel / Rewrite)
          ▼
  [ AWS EC2 ap-south-1 (Mumbai) ]
  ┌──────────────────────────────────────────────────┐
  │  Docker Compose                                  │
  │  ├── gex_backend (FastAPI + DhanHQ + APScheduler)│
  │  │     └── Ingests live option chain (every 5m)  │
  │  │     └── Ingests EOD participant data (daily)  │
  │  │     └── Calculates dynamic α & dealer weights │
  │  └── gex_postgres (PostgreSQL 16 Alpine)         │
  │        └── Persistent volume for time-series GEX │
  └──────────────────────────────────────────────────┘
```

---

## Step 1: Launch EC2 Instance in AWS Mumbai

1. Log in to the [AWS Management Console](https://console.aws.amazon.com/).
2. In the top-right region selector, select **Asia Pacific (Mumbai) `ap-south-1`**.
3. Go to **EC2** -> **Launch Instance**:
   - **Name**: `gex-backend-mumbai`
   - **OS / AMI**: **Ubuntu Server 24.04 LTS** (64-bit x86)
   - **Instance Type**: **`t3.micro`** (2 vCPU, 1 GB RAM) or **`t2.micro`** (Free tier eligible)
   - **Key Pair**: Create new (e.g. `gex-mumbai.pem`) and download the `.pem` file to your Mac.
   - **Network Settings / Security Group**:
     - Allow **SSH** traffic (Port 22) from your IP (or Anywhere `0.0.0.0/0`)
     - Allow **HTTP** traffic (Port 80) from Anywhere (`0.0.0.0/0`)
     - Allow **HTTPS** traffic (Port 443) from Anywhere (`0.0.0.0/0`)
     - Add Custom TCP Rule: **Port 8000**, CIDR: `0.0.0.0/0`
   - **Configure Storage**: Change the volume size from 8 GiB to **25 GiB** or **30 GiB** (up to 30 GiB is 100% free under AWS Free Tier).
4. Click **Launch Instance**.

---

## Step 2: Allocate an Elastic IP (Recommended)

*By default, EC2 public IPs change if the instance is stopped. An Elastic IP is free as long as your instance is running.*

1. In EC2 sidebar, click **Elastic IPs** -> **Allocate Elastic IP address** -> click **Allocate**.
2. Select the allocated IP -> **Actions** -> **Associate Elastic IP address**.
3. Select your `gex-backend-mumbai` instance and click **Associate**.

---

## Step 3: Connect to your EC2 Instance via SSH

Open Terminal on your Mac:
```bash
chmod 400 ~/Downloads/gex-mumbai.pem
ssh -i ~/Downloads/gex-mumbai.pem ubuntu@<YOUR_EC2_PUBLIC_IP>
```

---

## Step 4: Clone the Repo & Run the Automated Setup

Run the following commands inside your EC2 terminal:

```bash
# 1. Clone your repository
git clone https://github.com/<YOUR_GITHUB_USERNAME>/Gamma-Exposure-Dashboard.git
cd Gamma-Exposure-Dashboard/backend-python

# 2. Configure Environment Variables
cp .env.example .env
nano .env
```

*In `.env`, make sure to fill in:*
```ini
DHAN_CLIENT_ID=1100568869
DHAN_ACCESS_TOKEN=your_token_here
DEALER_ALPHA=0.65
INDIA_TICKERS=NIFTY,BANKNIFTY,SENSEX
```
Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

Now run the 1-click deploy script:
```bash
chmod +x deploy-aws.sh
./deploy-aws.sh
```

### What `deploy-aws.sh` does automatically:
1. **Creates a 4GB Swapfile**: Ensures the 1GB RAM instance never hits Linux Out-Of-Memory (OOM) errors during Docker builds or ML imports.
2. **Installs Docker & Docker Compose**: Sets up modern Docker engine.
3. **Spins up PostgreSQL 16**: Auto-heals and persists data in a Docker volume.
4. **Builds Backend Container**: Compiles Python 3.12, downloads CPU-only PyTorch, installs requirements.
5. **Applies DB Migrations**: Runs `alembic upgrade head` including dealer weights tables.
6. **Validates Health**: Verifies `http://localhost:8000/health`.

---

## Step 5: Connect with Vercel Frontend

Because your Vercel frontend is loaded over **HTTPS**, modern browsers will block plain **HTTP** requests to `http://<EC2_IP>:8000` (Mixed Content restriction).

Choose either of the two easy options below:

### Option A: Next.js Server Rewrite (Zero Configuration on EC2, 1-Minute Setup)

In Vercel:
1. Go to your project on [vercel.com](https://vercel.com/) -> **Settings** -> **Environment Variables**.
2. Add the following two variables:
   - `BACKEND_PROXY_URL`: `http://<YOUR_EC2_PUBLIC_IP>:8000`
   - `NEXT_PUBLIC_BACKEND_URL`: `/api/py`
3. Click **Deployments** -> find your latest deployment -> click the `...` menu -> **Redeploy**.

> **How this works**: Next.js automatically rewrites `/api/py/:path*` to your EC2 backend server-to-server. The browser only makes HTTPS calls to Vercel, bypassing mixed-content restrictions without needing SSL certificates or domain names.

---

### Option B: Cloudflare Tunnel (Free SSL, Direct Connection, No Open Ports)

Run this once on your EC2 instance:
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel --url http://localhost:8000
```
Cloudflare will print an instant, free HTTPS URL like:
`https://example-random-words.trycloudflare.com`

In Vercel:
1. Add environment variable:
   - `NEXT_PUBLIC_BACKEND_URL`: `https://example-random-words.trycloudflare.com`
2. Redeploy frontend.

---

## Step 6: Verify Backend Operations

To check live backend logs on EC2:
```bash
cd Gamma-Exposure-Dashboard/backend-python
sudo docker compose logs -f backend
```

To test API directly from terminal or browser:
```bash
curl http://<YOUR_EC2_PUBLIC_IP>:8000/health
curl http://<YOUR_EC2_PUBLIC_IP>:8000/api/v1/india/gex/NIFTY
curl http://<YOUR_EC2_PUBLIC_IP>:8000/api/v1/india/weights
```
