import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    return [
      { source: '/api/:path*', destination: `${apiBase}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${apiBase}/socket.io/:path*` },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
