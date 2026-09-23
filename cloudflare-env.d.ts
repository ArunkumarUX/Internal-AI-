declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
declare namespace Cloudflare {
  interface Env {
    AI_GATEWAY_URL?: string;
    AI_GATEWAY_KEY?: string;
    AI_MODEL?: string;
    AI_FAST_MODEL?: string;
    MCP_ALLOWED_HOSTS?: string;
    [key: string]: unknown;
  }
}
