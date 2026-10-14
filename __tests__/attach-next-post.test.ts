import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  getUserMedia: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  prisma: { automation: { findMany: h.findMany, update: h.update } },
}));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: vi.fn(async () => ({ provider: "META", accessToken: "t" })),
  hasInstagramCredentials: () => true,
  getUserMedia: h.getUserMedia,
}));

import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";

const account = { id: "acc", provider: "META", accessToken: "x", zernioAccountId: null };
const media = [
  { id: "old_reel", media_product_type: "REELS", timestamp: "2026-10-14T14:58:07+0000" },
  { id: "carousel", media_product_type: "FEED", media_type: "CAROUSEL_ALBUM", timestamp: "2026-10-14T19:00:00+0000" },
  { id: "later_reel", media_product_type: "REELS", timestamp: "2026-10-14T21:00:00+0000" },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.getUserMedia.mockResolvedValue(media);
  h.update.mockResolvedValue({});
});

describe("next post or reel", () => {
  it("binds a carousel, not only reels", async () => {
    h.findMany.mockResolvedValue([
      { id: "c1", instagramAccountId: "acc", instagramAccount: account, createdAt: new Date("2026-10-14T15:35:00Z"), pendingNextSince: new Date("2026-10-14T16:31:00Z") },
    ]);
    await attachPendingNextReels();
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ postId: "carousel", pendingNextReel: false }) })
    );
  });

  it("counts from when 'next post' was switched on, not from creation", async () => {
    h.findMany.mockResolvedValue([
      { id: "c2", instagramAccountId: "acc", instagramAccount: account, createdAt: new Date("2026-10-01T00:00:00Z"), pendingNextSince: new Date("2026-10-14T20:00:00Z") },
    ]);
    await attachPendingNextReels();
    expect(h.update.mock.calls[0][0].data.postId).toBe("later_reel");
  });

  it("does nothing while nothing new was published", async () => {
    h.findMany.mockResolvedValue([
      { id: "c3", instagramAccountId: "acc", instagramAccount: account, createdAt: new Date("2026-10-14T22:00:00Z"), pendingNextSince: null },
    ]);
    await attachPendingNextReels();
    expect(h.update).not.toHaveBeenCalled();
  });
});
