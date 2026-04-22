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
    ],
  },
};

export default nextConfig;
