import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray lockfile above this directory otherwise
  // makes Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
