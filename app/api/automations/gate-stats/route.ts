import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { CLICK_ROW_SELECT, countUniqueClicksBy } from "@/lib/tracking/analytics";

export const dynamic = "force-dynamic";

/**
 * Follow-gate funnel for one campaign, built from the existing logs:
 * entries (DmLog rows for comments / keyword DMs), follow checks
 * (FollowCheck), deliveries (DmLog `reveal:` rows) and unique link clicks.
 *
 * A FOLLOWS check is not a follower gained: the person may have followed
 * long before the campaign. Nothing here claims otherwise.
 */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json({ success: false, error: "Missing campaign ID" }, { status: 400 });
  }
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
    select: { id: true },
  });
  if (!automation) {
    return NextResponse.json({ success: false, error: "Campaign not found" }, { status: 404 });
  }

  const entryWhere = {
    automationId,
    NOT: { commentId: { startsWith: "reveal:" } },
  };
  const revealWhere = { automationId, commentId: { startsWith: "reveal:" } };

  const [
    entries,
    entryPeople,
    openingSent,
    checkCounts,
    peopleConfirmed,
    unknownReasons,
    delivered,
    deliveryUncertain,
    deliveryFailed,
    clickRows,
  ] = await Promise.all([
    prisma.dmLog.count({ where: entryWhere }),
    prisma.dmLog.groupBy({ by: ["commenterId"], where: entryWhere }),
    prisma.dmLog.count({ where: { ...entryWhere, status: "SENT" } }),
    prisma.followCheck.groupBy({
      by: ["result"],
      where: { automationId },
      _count: { _all: true },
    }),
    prisma.followCheck.groupBy({
      by: ["userId"],
      where: { automationId, result: "FOLLOWS" },
    }),
    prisma.followCheck.groupBy({
      by: ["reason"],
      where: { automationId, result: "UNKNOWN" },
      _count: { _all: true },
      orderBy: { _count: { reason: "desc" } },
      take: 5,
    }),
    prisma.dmLog.count({ where: { ...revealWhere, status: "SENT" } }),
    prisma.dmLog.count({ where: { ...revealWhere, dmDeliveryUnconfirmed: true } }),
    prisma.dmLog.count({
      where: { ...revealWhere, status: "FAILED", dmDeliveryUnconfirmed: false },
    }),
    prisma.linkClick.findMany({ where: { automationId }, select: CLICK_ROW_SELECT }),
  ]);

  const checks = { FOLLOWS: 0, NOT_FOLLOWING: 0, UNKNOWN: 0 };
  for (const row of checkCounts) checks[row.result] = row._count._all;

  return NextResponse.json(
    {
      success: true,
      data: {
        entries,
        uniquePeople: entryPeople.length,
        openingSent,
        checks,
        peopleConfirmed: peopleConfirmed.length,
        unknownReasons: unknownReasons.map((r) => ({
          reason: r.reason ?? "unknown",
          count: r._count._all,
        })),
        delivered,
        deliveryUncertain,
        deliveryFailed,
        uniqueClicks: countUniqueClicksBy(clickRows, () => automationId).get(automationId) ?? 0,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
