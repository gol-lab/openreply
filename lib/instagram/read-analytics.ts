import * as meta from "@/lib/meta/client";
import { zernioRequest } from "@/lib/zernio/client";
import type { InstagramContext, ZernioContext } from "./context";

export async function getUserFollowStatus({
  context,
  recipientId,
}: {
  context: InstagramContext;
  recipientId: string;
}): Promise<boolean | null> {
  if (context.provider === "META")
    return meta.getUserFollowStatus(context.accessToken, recipientId);
  try {
    const result = await zernioRequest<{ isFollower: boolean | null }>({
      apiKey: context.apiKey,
      path: `/accounts/${encodeURIComponent(context.accountId)}/follow-status/${encodeURIComponent(recipientId)}?refresh=true`,
    });
    return typeof result.isFollower === "boolean" ? result.isFollower : null;
  } catch {
    return null;
  }
}

/**
 * Three-state follow lookup for the strict follow gate. Unlike
 * getUserFollowStatus it never collapses an error into a plain null: the
 * reason is kept so the panel can show why a check came back unknown.
 */
export async function checkFollowStatus({
  context,
  recipientId,
  timeoutMs,
}: {
  context: InstagramContext;
  recipientId: string;
  timeoutMs?: number;
}): Promise<meta.FollowCheckOutcome> {
  if (context.provider === "META")
    return meta.checkUserFollowsBusiness(context.accessToken, recipientId, timeoutMs);
  try {
    const result = await zernioRequest<{ isFollower: boolean | null }>({
      apiKey: context.apiKey,
      path: `/accounts/${encodeURIComponent(context.accountId)}/follow-status/${encodeURIComponent(recipientId)}?refresh=true`,
    });
    if (result.isFollower === true) return { state: "FOLLOWS" };
    if (result.isFollower === false) return { state: "NOT_FOLLOWING" };
    return { state: "UNKNOWN", reason: "field_missing" };
  } catch {
    return { state: "UNKNOWN", reason: "provider_error" };
  }
}

export async function getMediaInsights({
  context,
  mediaId,
  metrics,
}: {
  context: InstagramContext;
  mediaId: string;
  metrics: string[];
}): Promise<meta.InstagramMediaInsights> {
  if (context.provider === "META")
    return meta.getMediaInsights(context.accessToken, mediaId, metrics);
  const result = await zernioRequest<{
    platformAnalytics?: {
      platformPostId: string;
      accountId: string;
      analytics?: Record<string, unknown>;
    }[];
  }>({
    apiKey: context.apiKey,
    path: `/analytics?postId=${encodeURIComponent(mediaId)}&accountId=${encodeURIComponent(context.accountId)}&platform=instagram`,
  });
  const analytics = result.platformAnalytics?.find(
    (p) => p.accountId === context.accountId && p.platformPostId === mediaId
  )?.analytics;
  if (!analytics?.lastUpdated)
    throw new meta.PermissionError(
      "Zernio analytics have not synced for this post"
    );
  const values: meta.InstagramMediaInsights = {};
  const mapping = {
    views: "views",
    reach: "reach",
    likes: "likes",
    comments: "comments",
    saved: "saves",
    shares: "shares",
  } as const;
  for (const [metric, source] of Object.entries(mapping)) {
    const value = analytics[source];
    if (metrics.includes(metric) && typeof value === "number")
      values[metric as keyof meta.InstagramMediaInsights] = value;
  }
  return values;
}

export async function getFollowerCountSeries({
  context,
  igUserId,
}: {
  context: InstagramContext;
  igUserId: string;
}): Promise<meta.FollowerCountPoint[] | null> {
  if (context.provider === "META")
    return meta.getFollowerCountSeries(context.accessToken, igUserId);
  return null;
}

export async function getZernioFollowerSnapshots(context: ZernioContext) {
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const query = new URLSearchParams({
    accountId: context.accountId,
    metrics: "follower_count",
    metricType: "time_series",
    since,
    until,
  });
  const result = await zernioRequest<{
    accountId: string;
    metrics: {
      follower_count?: { values?: { date: string; value: number }[] };
    };
  }>({
    apiKey: context.apiKey,
    path: `/analytics/instagram/follower-history?${query}`,
  });
  if (result.accountId !== context.accountId)
    throw new Error("Unexpected Zernio follower account");
  return (result.metrics.follower_count?.values ?? []).map((p) => ({
    date: p.date,
    followers: p.value,
  }));
}
