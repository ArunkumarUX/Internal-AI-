import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function identity(request?: Request) {
  if (request && request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new ApiError("Request origin is not allowed.", 403);
  }
  const user = await getChatGPTUser();
  if (!user)
    throw new ApiError(
      "Sign in to save and work with your organisation’s data.",
      401,
    );
  return user;
}
export function database() {
  if (!env.DB)
    throw new ApiError(
      "Workspace storage is unavailable. Please try again.",
      503,
    );
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET)
    throw new ApiError(
      "Document storage is unavailable. Please try again.",
      503,
    );
  return env.BUCKET;
}
export async function log(userId: string, event: string, detail: string) {
  await database()
    .prepare(
      "INSERT INTO audit (id,user_id,event,detail,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), userId, event, detail, new Date().toISOString())
    .run();
}
export function failure(e: unknown) {
  console.error(e instanceof Error ? e.message : "Workspace error");
  return Response.json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : "The workspace could not complete this request. Your input has been kept; please try again.",
    },
    { status: e instanceof ApiError ? e.status : 503 },
  );
}
export async function saveRecord(
  userId: string,
  kind: string,
  data: unknown,
  id = crypto.randomUUID(),
) {
  const now = new Date().toISOString();
  await database()
    .prepare(
      "INSERT INTO records (id,user_id,kind,data,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE records.user_id=excluded.user_id AND records.kind=excluded.kind",
    )
    .bind(id, userId, kind, JSON.stringify(data), now, now)
    .run();
  return id;
}
