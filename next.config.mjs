/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: "0.3.0",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_COMMIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA
      ?? process.env.SOURCE_COMMIT_SHA
      ?? "local-uncommitted",
    NEXT_PUBLIC_APP_ENV:
      process.env.VERCEL_ENV
      ?? process.env.NODE_ENV
      ?? "development"
  }
};

export default nextConfig;
