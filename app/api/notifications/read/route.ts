import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { getAuthenticatedUser } from "@/lib/auth/session";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/notifications/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark one notification, or all of them, as seen.
 *
 * The id in the body is a filter and never an authorisation: every query is
 * scoped to the account the session resolves to, so a caller naming somebody
 * else's row changes nothing and is told nothing about whether it exists.
 */
async function handlePOST(request: Request) {
  const user = await getAuthenticatedUser();
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    all?: unknown;
  };

  const id = typeof body.id === "string" ? body.id : undefined;
  await markNotificationsRead(user, body.all === true ? undefined : id);

  const { unread } = await listNotifications(user);
  return NextResponse.json({ unread });
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
