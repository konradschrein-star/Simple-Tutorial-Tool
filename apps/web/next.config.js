import { config as loadEnv } from "dotenv";
// Load .env from the repo root at BUILD TIME so values referenced in the Edge
// middleware bundle (e.g. JWT_SECRET) are present when Next compiles it.
loadEnv({ path: "../../.env" });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["@repo/contracts", "@repo/db", "@repo/queue"],
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  experimental: {
    serverActions: {
      allowedOrigins: (process.env.ALLOWED_ORIGINS || "localhost:3000")
        .split(",")
        .map((s) => s.trim()),
      bodySizeLimit: "10gb",
    },
  },
  images: { formats: ["image/avif", "image/webp"] },
};

export default nextConfig;
