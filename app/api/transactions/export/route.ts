import { and, desc, eq, gte, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { csvRow } from "@/lib/csv";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { paiseToRupeeNumber } from "@/lib/money";
import { istMonthRange, monthRangeOf, resolveMonth } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV export — a Pro feature that exists.
 *
 * The plan listing is what the agent quotes when it sells the upgrade, so
 * anything in it has to be real. Gated on the plan for the same reason: a paid
 * feature that works without paying is not a feature, it is a claim.
 *
 * Amounts are written in rupees because a spreadsheet is a human-facing
 * boundary — going through lib/money.ts, which is the only place allowed to
 * convert paise.
 */
async function handleGET(request: Request) {
  const user = await getAuthenticatedUser();

  if (user.plan !== "pro") {
    return NextResponse.json(
      { error: "CSV export is part of Pro." },
      { status: 403 },
    );
  }

  /**
   * Export whichever month is being looked at.
   *
   * This always wrote the current month, so exporting while paged back to an
   * earlier one silently handed over the wrong rows — the worst kind of wrong,
   * because a CSV carries no sign of which month it came from until you read
   * the dates.
   */
  const requested = new URL(request.url).searchParams.get("month") ?? undefined;
  const shownMonth = resolveMonth(requested);
  const month = monthRangeOf(shownMonth);
  void istMonthRange;

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, user.id),
        gte(transactions.occurredOn, month.start),
        lt(transactions.occurredOn, month.endExclusive),
      ),
    )
    .orderBy(desc(transactions.occurredOn));

  const lines = [
    "date,merchant,category,amount_inr",
    ...rows.map((r) =>
      csvRow([
        r.occurredOn,
        r.merchant,
        r.category,
        paiseToRupeeNumber(r.amountPaise).toFixed(2),
      ]),
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trackmoney-${month.start.slice(0, 7)}.csv"`,
    },
  });
}

export async function GET(request: Request) {
  try {
    return await handleGET(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
