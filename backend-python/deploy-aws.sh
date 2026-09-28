#!/bin/bash
set -e

# ==============================================================================
# AWS EC2 Quick Deploy Script for Gamma Exposure Backend (ap-south-1 Mumbai)
# ==============================================================================

echo "=========================================================="
echo "  Gamma Exposure Backend — AWS EC2 Setup (Mumbai Region)  "
echo "=========================================================="

# 1. Setup 4GB Swap file (MANDATORY on t2.micro / t3.micro to avoid OOM crashes)
if [ ! -f /swapfile ]; then
    echo "Creating 4GB swapfile to prevent out-of-memory errors on micro instances..."
    sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swapfile active:"
    free -h
else
    echo "Swapfile already exists."
fi

# 2. Install Docker and Docker Compose if not already installed
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo usermod -aG docker "$USER"
    echo "Docker installed successfully."
fi

# 3. Check for .env file
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️ Please edit .env with your Dhan credentials and API keys if needed!"
fi

# 4. Create persistent data directories
mkdir -p data trained_models

# 5. Build and launch services
echo "Building and starting backend + database containers..."
sudo docker compose down 2>/dev/null || true
sudo docker compose up -d --build

# 6. Wait for health check
echo "Waiting for backend service to become healthy..."
sleep 10

HEALTH_CHECK_PASSED=false
for i in {1..12}; do
    if curl -s http://localhost:8000/health | grep -q "healthy"; then
        HEALTH_CHECK_PASSED=true
        break
    fi
    echo "Waiting for backend to boot (attempt $i/12)..."
    sleep 5
done

echo ""
echo "=========================================================="
if [ "$HEALTH_CHECK_PASSED" = true ]; then
    echo "  ✅ Backend is RUNNING and HEALTHY on port 8000!  "
else
    echo "  ⚠️ Backend is starting. Check logs with: sudo docker compose logs -f backend"
fi
echo "=========================================================="
echo ""
PUBLIC_IP=$(curl -s ifconfig.me || echo "<YOUR_EC2_PUBLIC_IP>")
echo "Direct Backend URL: http://$PUBLIC_IP:8000"
echo "Health Check:       http://$PUBLIC_IP:8000/health"
echo "API Docs:           http://$PUBLIC_IP:8000/docs"
echo ""
echo "Next Steps to link with Vercel:"
echo "1. Because Vercel uses HTTPS, modern browsers block HTTP requests."
echo "2. Quickest Free HTTPS (1 command):"
echo "   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
echo "   sudo dpkg -i cloudflared.deb"
echo "   cloudflared tunnel --url http://localhost:8000"
echo "   (This outputs a free https://xxxx.trycloudflare.com URL that you paste into Vercel!)"
echo "3. Update Vercel environment variable:"
echo "   NEXT_PUBLIC_BACKEND_URL=https://<your-https-url>"
echo "=========================================================="
