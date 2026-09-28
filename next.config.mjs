/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_PROXY_URL
    if (backendUrl) {
      return [
        {
          source: '/api/py/:path*',
          destination: `${backendUrl.replace(/\/+$/, '')}/:path*`,
        },
      ]
    }
    return []
  },
}

export default nextConfig
