import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  // La vista local no comparte archivos con las compilaciones de producción.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-local" : ".next",
  cacheComponents: true,
  partialPrefetching: true,
});

export default nextConfig;
