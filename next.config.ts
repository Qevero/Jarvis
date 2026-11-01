import type { NextConfig } from "next";

// Jarvis is a single-user app that holds financial and tax data, so pages are
// rendered per request and never cached on the server (Cache Components off).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  async rewrites() {
    // OAuth Protected Resource Metadata (RFC 9728). MCP clients probe both the
    // path-suffixed and root forms, so both point at the same handler.
    return [
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth-protected-resource",
      },
    ];
  },
};

export default nextConfig;
