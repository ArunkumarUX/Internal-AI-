import { z } from "zod";
import { database, failure, identity, log, ApiError } from "@/lib/server";
import { adminAccount, listAccounts, normaliseEmail } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const MAX_MEMBERS = 200;
/** Everyone in the workspace; emails are shown to the admin only. */
export async function GET() {
  try {
    const user = await identity();
    const admin = user.role === "admin";
    const people = (await listAccounts()).map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      ...(admin || a.id === user.userId ? { email: a.email } : {}),
    }));
    return Response.json({ me: user.userId, admin, people });
  } catch (e) {
    return failure(e);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    name: z.string().trim().min(1, "Enter a name.").max(80),
    email: z.string().trim().email("Enter a valid email, like name@company.com.").max(200),
  }),
  z.object({ action: z.literal("remove"), id: z.string().max(100) }),
]);

/** Admin only: add or remove a teammate. They sign in with a code sent to their email. */
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    if (user.role !== "admin") throw new ApiError("Only the workspace admin can manage the team.", 403);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "Invalid request.");
    const body = parsed.data;
    const db = database();
    const now = new Date().toISOString();
    const owner = adminAccount();

    if (body.action === "add") {
      const email = normaliseEmail(body.email);
      if (owner && email === owner.email) throw new ApiError("That email is the admin’s sign-in.", 409);
      const count = await db.prepare("SELECT count(*) AS n FROM members").first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_MEMBERS) throw new ApiError(`The team is limited to ${MAX_MEMBERS} people.`, 409);
      const id = `u_${crypto.randomUUID()}`;
      const result = await db
        .prepare(
          "INSERT INTO members (id,email,name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING",
        )
        .bind(id, email, body.name, "", "member", now, now)
        .run();
      if (!result.meta.changes) throw new ApiError("Someone on the team already uses that email.", 409);
      await log(user.userId, "Teammate added", email);
      return Response.json({ id });
    }

    if (owner && body.id === owner.id)
      throw new ApiError("The admin’s sign-in is set in the deployment settings, not here.", 400);

    // Remove: they lose access immediately. Their messages and conversation
    // membership stay, so others still see who they were talking to.
    const result = await db.prepare("DELETE FROM members WHERE id=?").bind(body.id).run();
    if (!result.meta.changes) throw new ApiError("That teammate no longer exists.", 404);
    await log(user.userId, "Teammate removed", body.id);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
