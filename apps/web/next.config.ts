import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // AWS S3 bucket for product images (us-east-2 region)
        protocol: "https",
        hostname: "superherocpr-assets-staging.s3.us-east-2.amazonaws.com",
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
    ],
  },
};

export default nextConfig;
