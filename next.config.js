/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // 支持better-sqlite3
    if (isServer) {
      config.externals.push('better-sqlite3');
    }
    return config;
  },
}

module.exports = nextConfig
