import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
