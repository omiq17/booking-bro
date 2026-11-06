import type { NextConfig } from 'next';

const apiInternalUrl = process.env.API_INTERNAL_URL || 'http://localhost:3001';

const nextConfig: NextConfig = {
  transpilePackages: ['@booking-bro/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
