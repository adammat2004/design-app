import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  webpack(config) {
    // Konva runs only in client canvases. Its optional Node canvas backend is not bundled.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
