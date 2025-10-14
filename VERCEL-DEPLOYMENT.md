# Vercel Deployment Guide

## 🚀 Deploy Your Frontend to Vercel

### Method 1: Via Vercel Dashboard (Recommended)

1. **Go to Vercel**: https://vercel.com/new
2. **Import Git Repository**:
   - Click "Import Project"
   - Select "Import Git Repository"
   - Choose: `Vdarak/Gamma-Exposure-Dashboard`
   - Click "Import"

3. **Configure Project**:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `./` (leave as default)
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `.next` (auto-filled)

4. **Add Environment Variable**:
   - Click "Environment Variables"
   - Add variable:
     - **Name**: `NEXT_PUBLIC_BACKEND_URL`
     - **Value**: `https://backend-api-production-7f7a.up.railway.app`
     - Check ✅ **Production**, **Preview**, **Development**

5. **Deploy**:
   - Click "Deploy"
   - Wait 2-3 minutes for build
   - Your app will be live at: `https://gamma-exposure-dashboard.vercel.app`

---

### Method 2: Via Vercel CLI

```bash
# Install Vercel CLI (if not already installed)
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# Add environment variable
vercel env add NEXT_PUBLIC_BACKEND_URL production
# When prompted, enter: https://backend-api-production-7f7a.up.railway.app

# Deploy to production
vercel --prod
```

---

## ✅ Verify Deployment

Once deployed:

1. **Visit your site**: `https://your-site.vercel.app`
2. **Open browser console** (F12)
3. **Check API connection**:
   ```javascript
   fetch('https://backend-api-production-7f7a.up.railway.app/health')
     .then(r => r.json())
     .then(console.log)
   ```

Should see: `{ status: "ok", timestamp: "...", uptime: 123 }`

---

## 🔄 Future Updates

After making changes:

```bash
# Commit changes
git add .
git commit -m "Your update message"
git push

# Vercel will automatically redeploy! 🚀
```

---

## 🐛 Troubleshooting

### CORS Errors
- Make sure backend CORS includes your Vercel domain
- Already configured: `*.vercel.app` pattern

### Environment Variable Not Working
- Go to Vercel Dashboard → Settings → Environment Variables
- Make sure `NEXT_PUBLIC_BACKEND_URL` is set for all environments
- Redeploy after adding

### Build Fails
- Check Vercel build logs
- Make sure all dependencies are in `package.json`
- Ensure no TypeScript errors: `npm run build` locally first

---

## 📊 Your Stack

- **Frontend**: Vercel (Next.js 14)
- **Backend**: Railway (Node.js + PostgreSQL)
- **GitHub**: Source control
- **Auto-deploy**: Push to main → Vercel rebuilds automatically

**You're all set! 🎉**
