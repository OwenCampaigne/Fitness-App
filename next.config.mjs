/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['garmin-connect', 'web-push'],
  },
};

export default nextConfig;
