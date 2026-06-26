/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'garmin-connect',
      'web-push',
      '@prisma/client',
      '@prisma/adapter-better-sqlite3',
      'better-sqlite3',
    ],
  },
};

export default nextConfig;
