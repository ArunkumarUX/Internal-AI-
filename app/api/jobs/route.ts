import { z } from "zod";
import { identity, database, saveRecord, log, failure, ApiError } from "@/lib/server";
import { answer, readSkills } from "@/lib/engine";

/**
 * Scheduled questions. Jobs are stored per user; due jobs run when the
 * workspace is open (the client calls `run-due`) or on demand.
 */

type Job = {
  title: string;
  prompt: string;
  cadence: "daily" | "weekdays" | "weekly";
  time: string;
  weekday: number;
  tzOffset: number;
  /** IANA zone, e.g. "Europe/London"; preferred over tzOffset so DST is respected. */
  timeZone?: string;
  enabled: boolean;
  nextRun: string;
  lastRun?: string;
  lastStatus?: string;
  /** Set while a run is in progress; stale after LOCK_MS. */
  runningSince?: string;
};

const LOCK_MS = 10 * 60 * 1000;
const lockCutoff = () => new Date(Date.now() - LOCK_MS).toISOString();

const schedule = z.object({
  cadence: z.enum(["daily", "weekdays", "weekly"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekday: z.number().int().min(0).max(6).default(1),
  tzOffset: z.number().int().min(-840).max(840).default(0),
  timeZone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});

const body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    title: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(3).max(4000),
  }).merge(schedule),
  z.object({
    op: z.literal("update"),
    id: z.string().max(100),
    title: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().trim().min(3).max(4000).optional(),
    enabled: z.boolean().optional(),
  }).merge(schedule.partial()),
  z.object({ op: z.literal("delete"), id: z.string().max(100) }),
  z.object({ op: z.literal("run"), id: z.string().max(100) }),
  z.object({ op: z.literal("run-due") }),
]);

/** A specific message for the field that failed validation. */
function invalid(issues: z.ZodIssue[]) {
  const issue = issues.find((i) => i.path[0] === "title" || i.path[0] === "prompt") ?? issues[0];
  const long = issue?.code === "too_big";
  if (issue?.path[0] === "title")
    return long ? "Keep the job name under 120 characters." : "Give the job a name.";
  if (issue?.path[0] === "prompt")
    return long
      ? "Keep the job question under 4,000 characters."
      : "Write the question the job should ask.";
  return "Check the job name, question and schedule.";
}

/** Minutes the zone is ahead of UTC at `at` (UK summer = 60). */
function zoneOffset(timeZone: string, at: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/** The UTC instant of a local wall-clock time; dates may overflow (day 32). */
function localToUtc(job: Pick<Job, "tzOffset" | "timeZone">, y: number, mo: number, d: number, h: number, mi: number) {
  const wall = Date.UTC(y, mo, d, h, mi);
  if (!job.timeZone) return wall + job.tzOffset * 60000;
  const first = wall - zoneOffset(job.timeZone, wall) * 60000;
  // Re-check at the candidate instant in case a DST change lies in between.
  return wall - zoneOffset(job.timeZone, first) * 60000;
}

/** Next run strictly after `from`, in the user's local time. */
function nextRun(job: Pick<Job, "cadence" | "time" | "weekday" | "tzOffset" | "timeZone">, from = new Date()) {
  const [h, m] = job.time.split(":").map(Number);
  const offset = job.timeZone ? zoneOffset(job.timeZone, from.getTime()) : -job.tzOffset;
  const today = new Date(from.getTime() + offset * 60000);
  for (let d = 0; d < 9; d++) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + d)).getUTCDay();
    if (job.cadence === "weekdays" && (day === 0 || day === 6)) continue;
    if (job.cadence === "weekly" && day !== job.weekday) continue;
    const at = localToUtc(job, today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + d, h, m);
    if (at > from.getTime()) return new Date(at).toISOString();
  }
  return new Date(from.getTime() + 86400000).toISOString();
}

async function load(userId: string, id: string) {
  const row = await database()
    .prepare("SELECT data FROM records WHERE id=? AND user_id=? AND kind='job'")
    .bind(id, userId)
    .first();
  if (!row) throw new ApiError("Scheduled job not found.", 404);
  return JSON.parse(String(row.data)) as Job;
}

async function run(user: { userId: string; displayName: string }, id: string, job: Job) {
  const started = new Date();
  let status = "Completed";
  try {
    const result = await answer(
      user,
      { query: job.prompt, scope: "All knowledge", verified: false, attachmentIds: [], history: [] },
      () => {},
      false,
    );
    await saveRecord(user.userId, "job-run", {
      jobId: id,
      title: job.title,
      prompt: job.prompt,
      text: result.text,
      sourceIds: result.sourceIds,
      mode: result.mode,
      at: started.toISOString(),
    });
    // Keep the 20 most recent results per job; a failure here isn't a failed run.
    await database()
      .prepare(
        "DELETE FROM records WHERE user_id=? AND kind='job-run' AND json_extract(data,'$.jobId')=? AND id NOT IN (SELECT id FROM records WHERE user_id=? AND kind='job-run' AND json_extract(data,'$.jobId')=? ORDER BY created_at DESC LIMIT 20)",
      )
      .bind(user.userId, id, user.userId, id)
      .run()
      .catch((e) => console.error("job retention", e instanceof Error ? e.message : e));
  } catch (e) {
    status = `Failed: ${(e as Error).message}`.slice(0, 200);
  }
  // Update only the run fields of the current row (and release the lock):
  // edits or a delete made while the job was running must win over this copy.
  const updated = await database()
    .prepare(
      "UPDATE records SET data=json_remove(json_set(data,'$.lastRun',?,'$.lastStatus',?),'$.runningSince'),updated_at=? WHERE id=? AND user_id=? AND kind='job'",
    )
    .bind(started.toISOString(), status, new Date().toISOString(), id, user.userId)
    .run();
  if (!updated.meta.changes) {
    // Deleted mid-run: drop the result so it doesn't linger unseen.
    await database()
      .prepare("DELETE FROM records WHERE user_id=? AND kind='job-run' AND json_extract(data,'$.jobId')=?")
      .bind(user.userId, id)
      .run();
    return "Deleted while running";
  }
  await log(user.userId, "Scheduled job ran", `${job.title} · ${status}`).catch(() => {});
  return status;
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(invalid(parsed.error.issues));
    const input = parsed.data;
    if (input.op === "create") {
      const count = await database()
        .prepare("SELECT COUNT(*) AS n FROM records WHERE user_id=? AND kind='job'")
        .bind(user.userId)
        .first();
      if (Number(count?.n ?? 0) >= 25) throw new ApiError("You can schedule up to 25 jobs.");
      const { op: _op, ...fields } = input;
      const job: Job = { ...fields, enabled: true, nextRun: nextRun(fields) };
      const id = await saveRecord(user.userId, "job", job);
      await log(user.userId, "Scheduled job created", job.title);
      return Response.json({ id, job });
    }
    if (input.op === "update") {
      const current = await load(user.userId, input.id);
      const { op: _op, id, ...patch } = input;
      const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const job = { ...current, ...changes } as Job;
      // Reschedule only when timing changed or the job is switched back on,
      // so renaming a job doesn't skip a run that is already due.
      const timing = ["cadence", "time", "weekday", "tzOffset", "timeZone"].some(
        (k) => k in changes && changes[k] !== current[k as keyof Job],
      );
      if (timing || (changes.enabled === true && !current.enabled)) job.nextRun = nextRun(job);
      await saveRecord(user.userId, "job", job, id);
      return Response.json({ id, job });
    }
    if (input.op === "delete") {
      await database()
        .prepare("DELETE FROM records WHERE id=? AND user_id=? AND kind='job'")
        .bind(input.id, user.userId)
        .run();
      await database()
        .prepare("DELETE FROM records WHERE user_id=? AND kind='job-run' AND json_extract(data,'$.jobId')=?")
        .bind(user.userId, input.id)
        .run();
      await log(user.userId, "Scheduled job deleted", input.id);
      return Response.json({ ok: true });
    }
    const skills = await readSkills(user.userId);
    if (!skills.jobs) throw new ApiError("Turn on the Scheduled jobs skill to run jobs.", 409);
    if (input.op === "run") {
      const job = await load(user.userId, input.id);
      const now = new Date();
      // Take the lock; a manual run of a due job also counts as its scheduled run.
      const due = job.enabled && job.nextRun <= now.toISOString();
      const lock = await database()
        .prepare(
          "UPDATE records SET data=json_set(data,'$.runningSince',?,'$.nextRun',?) WHERE id=? AND user_id=? AND kind='job' AND (json_extract(data,'$.runningSince') IS NULL OR json_extract(data,'$.runningSince')<?)",
        )
        .bind(now.toISOString(), due ? nextRun(job, now) : job.nextRun, input.id, user.userId, lockCutoff())
        .run();
      if (!lock.meta.changes) throw new ApiError("This job is already running.", 409);
      const status = await run(user, input.id, job);
      return Response.json({ status, ok: status === "Completed" });
    }
    // run-due: bounded so opening the app never triggers a long burst.
    const due = await database()
      .prepare(
        "SELECT id,data FROM records WHERE user_id=? AND kind='job' AND json_extract(data,'$.enabled')=1 AND json_extract(data,'$.nextRun')<=? AND (json_extract(data,'$.runningSince') IS NULL OR json_extract(data,'$.runningSince')<?) ORDER BY json_extract(data,'$.nextRun') LIMIT 2",
      )
      .bind(user.userId, new Date().toISOString(), lockCutoff())
      .all();
    const ran: { id: string; status: string }[] = [];
    for (const row of due.results) {
      const job = JSON.parse(String(row.data)) as Job;
      // Claim the job first so two open tabs can't run it twice.
      const claim = await database()
        .prepare(
          "UPDATE records SET data=json_set(data,'$.nextRun',?,'$.runningSince',?) WHERE id=? AND user_id=? AND json_extract(data,'$.nextRun')=? AND (json_extract(data,'$.runningSince') IS NULL OR json_extract(data,'$.runningSince')<?)",
        )
        .bind(nextRun(job), new Date().toISOString(), String(row.id), user.userId, job.nextRun, lockCutoff())
        .run();
      if (!claim.meta.changes) continue;
      ran.push({ id: String(row.id), status: await run(user, String(row.id), job) });
    }
    return Response.json({ ran });
  } catch (e) {
    return failure(e);
  }
}
