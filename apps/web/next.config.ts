import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@nutria/db", "@nutria/core", "@nutria/ai", "@nutria/integrations", "@nutria/nutrition"],
  // Native / Node-only deps stay out of the bundle.
  serverExternalPackages: ["postgres", "pg-boss", "web-push", "@anthropic-ai/claude-agent-sdk", "@electric-sql/pglite"],
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/", destination: "/hoy", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
