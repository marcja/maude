import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Exclude better-sqlite3 from webpack bundling — it's a native Node.js addon
  // (.node file) that webpack can't bundle. Without this, Next.js tries to
  // bundle it and fails at runtime with ENOENT or "cannot find module" errors.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
