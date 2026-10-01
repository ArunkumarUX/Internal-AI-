import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const cfStub = path.join(root, "lib/cf-env-stub.ts");
const envFile = path.join(root, "lib/env.ts");

const nextConfig: NextConfig = {
  // The development "N" badge sits on top of the profile avatar; hide it so
  // local development looks like production.
  devIndicators: false,
  outputFileTracingRoot: root,
  serverExternalPackages: ["sql.js", "postgres"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/sql.js/dist/sql-wasm.wasm"],
  },
  webpack: (config) => {
    const alias =
      config.resolve.alias &&
      typeof config.resolve.alias === "object" &&
      !Array.isArray(config.resolve.alias)
        ? config.resolve.alias
        : {};
    config.resolve.alias = {
      ...alias,
      [envFile]: cfStub,
      "@/lib/env": cfStub,
      "cloudflare:workers": cfStub,
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      "@/lib/env": "./lib/cf-env-stub.ts",
      "cloudflare:workers": "./lib/cf-env-stub.ts",
    },
  },
};

export default nextConfig;
