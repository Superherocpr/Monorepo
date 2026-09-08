import type { NextConfig } from "next";
import { execSync } from "child_process";
import { version } from "./package.json";

/** Short git SHA baked in at build time — falls back to "dev" in local environments without git. */
function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    // e.g. "v1.0.0 (abc1234)" — visible in the admin sidebar footer
    NEXT_PUBLIC_APP_VERSION: `v${version} (${gitShortSha()})`,
  },
  images: {
    remotePatterns: [
      {
        // AWS S3 — matches any bucket name and any region (e.g. us-east-2, us-west-2).
        // ** matches any number of subdomain segments so bucket.s3.region.amazonaws.com
        // all resolve correctly regardless of which environment the app runs in.
        protocol: "https",
        hostname: "**.amazonaws.com",
        pathname: "/**",
      },
      {
        // Placeholder images used in staging/seed data only — not for production
        protocol: "https",
        hostname: "placehold.co",
        pathname: "/**",
      },
      {
        // Facebook CDN — images are served from deeply nested subdomains (e.g. scontent-mia5-2.xx.fbcdn.net)
        // ** matches any number of subdomain levels
        protocol: "https",
        hostname: "**.fbcdn.net",
        pathname: "/**",
      },
      {
        // ChamberMaster serves association logos from Azure Blob Storage.
        protocol: "https",
        hostname: "chambermaster.blob.core.windows.net",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
