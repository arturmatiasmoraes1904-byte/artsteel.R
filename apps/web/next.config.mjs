/** @type {import('next').NextConfig} */
const nextConfig = {
  // Builds on this Windows workspace are more reliable with one worker.
  // It avoids concurrent .next writes while preserving production Webpack builds.
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
