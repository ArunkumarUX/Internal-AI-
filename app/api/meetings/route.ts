import { failure, identity } from "@/lib/server";
import { listMeetings, microsoftStatus, type Meeting } from "@/lib/microsoft";
import { googleStatus, listGoogleMeetings } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

/** Your meetings from Outlook/Teams and Google Calendar, from yesterday to a week ahead. */
export async function GET() {
  try {
    const user = await identity();
    const [microsoft, google] = await Promise.all([microsoftStatus(user.userId), googleStatus(user.userId)]);
    const errors: string[] = [];
    const safely = (load: Promise<Meeting[]>) =>
      load.catch((e: Error) => {
        errors.push(e.message);
        return [] as Meeting[];
      });
    const lists = await Promise.all([
      microsoft.connected ? safely(listMeetings(user.userId)) : [],
      google.connected ? safely(listGoogleMeetings(user.userId)) : [],
    ]);
    // The same meeting can be on both calendars: keep one per title + start.
    const seen = new Set<string>();
    const meetings = lists
      .flat()
      .filter((m) => {
        const key = `${m.title.toLowerCase()}|${m.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    return Response.json(
      {
        // Kept for older clients: the Microsoft fields at the top level.
        ...microsoft,
        microsoft,
        google,
        meetings,
        error: errors[0] ?? "",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
