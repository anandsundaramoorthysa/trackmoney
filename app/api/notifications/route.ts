import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listNotifications } from "@/lib/notifications/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bell's own endpoint.
 *
 * This is where generation happens, which is why it is not called from a layout
 * render: `computeUsageFacts` is three queries and a layout renders on every
 * navigation. Here it runs when somebody actually looks.
 *
 * Reading the list does not mark anything read and does not pitch. Marking is a
 * separate POST because it is a decision the person makes by opening the panel,
 * not something a background refresh should do on their behalf.
 */
async function handleGET() {
  const user = await getAuthenticatedUser();
  const { items, unread } = await listNotifications(user);
  return NextResponse.json({ unread, items });
}

export async function GET() {
  try {
    return await handleGET();
  } catch (error) {
    return handleRouteError(error);
  }
}
