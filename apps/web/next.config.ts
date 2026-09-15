import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  /*
   * Out of the bottom-left corner, which the product now uses.
   *
   * On a narrow window the designer's at-work block is a bar fixed to the bottom of the viewport,
   * and Stop is the first control on it. The dev indicator defaults to exactly that corner and sits
   * over it — in development only, but that is where this is looked at and tested. Moved rather
   * than hidden: it still reports compilation state, just somewhere nothing is competing for.
   */
  devIndicators: { position: 'top-right' },
  webpack(config) {
    // Konva runs only in client canvases. Its optional Node canvas backend is not bundled.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
