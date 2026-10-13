import { describe, it, expect, vi, beforeEach } from "vitest";

// Strict follow gate (followGateStrict): the link is released only on a
// confirmed follow. Unknown / error / timeout keep it locked.

const h = vi.hoisted(() => {
  const claims = new Set<string>();
  const redis = new Map<string, string>();
  return {
    claims,
    redis,
    prisma: {
      zernioConnection: { findUnique: vi.fn() },
      postbackDelivery: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          if (claims.has(data.id)) {
            throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
          }
          claims.add(data.id);
          return data;
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          claims.delete(where.id);
          return {};
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          claims.has(where.id) ? { id: where.id } : null
        ),
      },
      automation: { findMany: vi.fn(), findFirst: vi.fn() },
      dmLog: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      followCheck: { create: vi.fn() },
      instagramAccount: { findUnique: vi.fn() },
      operationalEvent: { create: vi.fn() },
    },
    checkUserFollowsBusiness: vi.fn(),
    sendButtonTemplate: vi.fn(),
    sendDirectMessageWithLinkButton: vi.fn(),
    sendDirectMessage: vi.fn(),
    sendPrivateReplyWithButton: vi.fn(),
    sendCommentReply: vi.fn(),
    queueAdd: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));

vi.mock("@/lib/meta/client", () => {
  class MetaApiError extends Error {
    code: number;
    constructor(code: number, _s: number | undefined, _t: string | undefined, message: string) {
      super(message);
      this.code = code;
      this.name = "MetaApiError";
    }
  }
  return {
    checkUserFollowsBusiness: h.checkUserFollowsBusiness,
    sendButtonTemplate: h.sendButtonTemplate,
    sendDirectMessageWithLinkButton: h.sendDirectMessageWithLinkButton,
    sendDirectMessage: h.sendDirectMessage,
    sendPrivateReplyWithButton: h.sendPrivateReplyWithButton,
    sendCommentReply: h.sendCommentReply,
    getUserFollowStatus: vi.fn(),
    sendPrivateReply: vi.fn(),
    sendPrivateReplyWithLinkButton: vi.fn(),
    sendDirectMessageWithButton: vi.fn(),
    MetaApiError,
    TokenExpiredError: class TokenExpiredError extends MetaApiError {},
    RateLimitError: class RateLimitError extends MetaApiError {},
  };
});

vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "decrypted_token" }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: vi.fn(async () => ({ allowed: true, reserved: true })),
  releaseDMSlot: vi.fn(),
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, periodStart: new Date(0) })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: h.queueAdd }),
  getRedisConnection: () => ({
    set: vi.fn(async (key: string, value: string, _px: string, _ms: number, nx: string) => {
      if (nx === "NX" && h.redis.has(key)) return null;
      h.redis.set(key, value);
      return "OK";
    }),
  }),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__strictProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  return {
    Worker: MockWorker,
    UnrecoverableError: class UnrecoverableError extends Error {},
  };
});

import { createDMWorker, strictDeliveryClaimId } from "../lib/queue/dm-worker";
import { MetaApiError } from "@/lib/meta/client";

type AnyJob = { name?: string; data: Record<string, unknown>; id: string; attemptsMade: number };

function processor(): (job: AnyJob) => Promise<void> {
  createDMWorker();
  return (global as Record<string, unknown>).__strictProcessor as (job: AnyJob) => Promise<void>;
}

const USER = "igsid_fan";
const campaign = {
  id: "auto_gollab",
  name: "GOL LAB | Conteúdo exclusivo",
  workspaceId: "ws_1",
  instagramAccountId: "acct_row_1",
  postId: "media_1",
  keywords: ["ANALISE", "ANÁLISE", "analise"],
  matchAnyWord: false,
  wholeWordMatch: true,
  dmTriggerEnabled: false,
  dmMessage: "Tudo certo! Aqui está o conteúdo que você pediu.",
  openingDmEnabled: true,
  openingDmMessage: "Vi que você comentou ANALISE. Vou te mandar o conteúdo.",
  openingDmButtonLabel: "Me envie a análise",
  linkButtonLabel: "Acessar conteúdo",
  requireFollow: true,
  followGateStrict: true,
  followPromptMessage: "Para receber o conteúdo, siga @gollab.com.br e depois toque em ‘Já estou seguindo’ aqui embaixo.",
  followPromptButtonLabel: "Já estou seguindo",
  followNotFollowingMessage: "NAO_SEGUE_TEXTO",
  followUnknownMessage: "DESCONHECIDO_TEXTO",
  profileButtonLabel: "Abrir perfil",
  publicReplyEnabled: true,
  publicReplyMessage: "Te mandei os próximos passos no direct.",
  publicReplyMessages: ["Te mandei os próximos passos no direct."],
  publicReplyAfterDm: true,
  followUpEnabled: false,
  followUpMessage: null,
  followUpDelayMinutes: 0,
  isActive: true,
  instagramAccount: {
    id: "acct_row_1",
    instagramId: "ig_business",
    username: "gollab.com.br",
    provider: "META",
    accessToken: "enc",
    zernioAccountId: null,
    workspaceId: "ws_1",
  },
  workspace: { id: "ws_1" },
  trackedLinks: [
    { slug: "abc123", label: "Acessar conteúdo", destinationUrl: "https://gollab.com.br/exclusivo" },
  ],
};

function tap(payload: string, extra: Record<string, unknown> = {}, mid = "mid_1"): AnyJob {
  return {
    name: "process-postback",
    id: `job_${mid}`,
    attemptsMade: 0,
    data: { instagramAccountId: "ig_business", userId: USER, payload, mid, ...extra },
  };
}

const retryTap = (mid?: string) => tap("followcheck:auto_gollab", {}, mid);
const openingTap = (mid?: string) => tap("followcheck:auto_gollab:open", {}, mid);

function sentLink() {
  return h.sendDirectMessageWithLinkButton.mock.calls.length;
}
function promptTexts(): string[] {
  return h.sendButtonTemplate.mock.calls.map((c) => c[3] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.claims.clear();
  h.redis.clear();
  h.prisma.automation.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; isActive?: boolean } }) =>
      where.id === campaign.id && (where.isActive !== true || campaign.isActive) ? campaign : null
  );
  h.prisma.automation.findMany.mockResolvedValue([campaign]);
  // The person entered the campaign by commenting.
  h.prisma.dmLog.findFirst.mockImplementation(
    async ({ where }: { where: { commenterId?: string; status?: string } }) => {
      if (where.status === "SENT") return null;
      return where.commenterId === USER ? { id: "entry_1", commenterName: "fan" } : null;
    }
  );
  h.prisma.dmLog.findUnique.mockResolvedValue(null);
  h.prisma.dmLog.upsert.mockResolvedValue({});
  h.prisma.dmLog.update.mockResolvedValue({});
  h.prisma.dmLog.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.followCheck.create.mockResolvedValue({});
  h.prisma.operationalEvent.create.mockResolvedValue({});
  h.sendButtonTemplate.mockResolvedValue({ message_id: "m_btn" });
  h.sendDirectMessageWithLinkButton.mockResolvedValue({ message_id: "m_link" });
  h.sendPrivateReplyWithButton.mockResolvedValue({ message_id: "m_open" });
  h.sendCommentReply.mockResolvedValue({ id: "c_reply" });
});

describe("strict follow gate — release rule", () => {
  it("1. confirmed follower: delivers the link once, logged as SENT", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    await processor()(retryTap());

    expect(sentLink()).toBe(1);
    const [, , userId, text, buttons] = h.sendDirectMessageWithLinkButton.mock.calls[0];
    expect(userId).toBe(USER);
    expect(text).toBe("Tudo certo! Aqui está o conteúdo que você pediu.");
    expect(buttons[0].title).toBe("Acessar conteúdo");
    expect(buttons[0].url).toContain("/r/abc123");
    expect(h.prisma.followCheck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ result: "FOLLOWS", source: "RETRY_TAP", userId: USER }),
    });
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "SENT", commentId: `reveal:${USER}` }) })
    );
  });

  it("2. confirmed non-follower: asks to follow again, never sends the link", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "NOT_FOLLOWING" });
    await processor()(retryTap());

    expect(sentLink()).toBe(0);
    expect(promptTexts()).toEqual(["NAO_SEGUE_TEXTO"]);
    const buttons = h.sendButtonTemplate.mock.calls[0][4];
    expect(buttons).toEqual([
      { type: "postback", title: "Já estou seguindo", payload: "followcheck:auto_gollab" },
      { type: "web_url", title: "Abrir perfil", url: "https://www.instagram.com/gollab.com.br/" },
    ]);
    // Keeps checking quietly in case the follow registers late.
    expect(h.queueAdd).toHaveBeenCalledWith(
      "process-postback",
      expect.objectContaining({ followRecheck: true, followRecheckAttempt: 1 }),
      expect.objectContaining({ delay: expect.any(Number) })
    );
  });

  it("3. field missing / unknown answer: stays locked with the 'could not verify' message", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "UNKNOWN", reason: "field_missing" });
    await processor()(retryTap());

    expect(sentLink()).toBe(0);
    expect(promptTexts()).toEqual(["DESCONHECIDO_TEXTO"]);
    expect(h.prisma.followCheck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ result: "UNKNOWN", reason: "field_missing" }),
    });
  });

  it.each([
    ["meta_error_100_2534014"],
    ["timeout"],
    ["network"],
  ])("4. API error or timeout (%s): stays locked, never accuses of not following", async (reason) => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "UNKNOWN", reason });
    await processor()(retryTap());

    expect(sentLink()).toBe(0);
    expect(promptTexts()).toEqual(["DESCONHECIDO_TEXTO"]);
    expect(promptTexts()).not.toContain("NAO_SEGUE_TEXTO");
  });

  it("5a. duplicate tap inside the cooldown: no second lookup, no second message", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "NOT_FOLLOWING" });
    const run = processor();
    await run(retryTap("mid_1"));
    await run(retryTap("mid_2"));

    expect(h.checkUserFollowsBusiness).toHaveBeenCalledTimes(1);
    expect(h.sendButtonTemplate).toHaveBeenCalledTimes(1);
  });

  it("5b. duplicate webhook for the same tap (same mid): one message only", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "UNKNOWN", reason: "timeout" });
    const run = processor();
    await run(retryTap("mid_same"));
    h.redis.clear(); // even if the cooldown expired, the tap's claim holds
    await run(retryTap("mid_same"));

    expect(h.sendButtonTemplate).toHaveBeenCalledTimes(1);
  });

  it("5c. taps after delivery never deliver twice", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    const run = processor();
    await run(retryTap("mid_1"));
    h.redis.clear();
    await run(retryTap("mid_2"));
    await run(openingTap("mid_3"));

    expect(sentLink()).toBe(1);
    expect(h.checkUserFollowsBusiness).toHaveBeenCalledTimes(1);
  });

  it("5d. a tap and a re-check racing to deliver: one send", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    const run = processor();
    await Promise.all([
      run(retryTap("mid_1")),
      run(tap("followcheck:auto_gollab", { followRecheck: true, followRecheckAttempt: 1 }, "recheck")),
    ]);

    expect(sentLink()).toBe(1);
  });

  it("6. paused campaign: a tap does nothing", async () => {
    campaign.isActive = false;
    try {
      h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
      await processor()(retryTap());
      expect(h.checkUserFollowsBusiness).not.toHaveBeenCalled();
      expect(sentLink()).toBe(0);
      expect(h.sendButtonTemplate).not.toHaveBeenCalled();
    } finally {
      campaign.isActive = true;
    }
  });

  it("6b. paused campaign: comments are not even looked up as active", async () => {
    h.prisma.automation.findMany.mockResolvedValue([]);
    await processor()({
      name: "process-comment",
      id: "c1",
      attemptsMade: 0,
      data: {
        instagramAccountId: "ig_business",
        commentId: "comment_1",
        commentText: "ANÁLISE",
        commenterId: USER,
        mediaId: "media_1",
      },
    });
    expect(h.prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) })
    );
    expect(h.sendPrivateReplyWithButton).not.toHaveBeenCalled();
  });
});

describe("strict follow gate — flow", () => {
  it("someone who follows during the flow: 'not yet', then the re-check delivers", async () => {
    const run = processor();
    h.checkUserFollowsBusiness.mockResolvedValueOnce({ state: "NOT_FOLLOWING" });
    await run(retryTap("mid_1"));
    expect(promptTexts()).toEqual(["NAO_SEGUE_TEXTO"]);

    const [name, recheckData] = h.queueAdd.mock.calls[0];
    expect(name).toBe("process-postback");
    h.checkUserFollowsBusiness.mockResolvedValueOnce({ state: "FOLLOWS" });
    await run({ name, id: "recheck_1", attemptsMade: 0, data: recheckData });

    expect(sentLink()).toBe(1);
    // The re-check itself sends no extra prompt.
    expect(h.sendButtonTemplate).toHaveBeenCalledTimes(1);
  });

  it("a re-check that still finds no follow stays silent", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "NOT_FOLLOWING" });
    await processor()(
      tap("followcheck:auto_gollab", { followRecheck: true, followRecheckAttempt: 2 }, "rc")
    );
    expect(h.sendButtonTemplate).not.toHaveBeenCalled();
    expect(sentLink()).toBe(0);
  });

  it("opening tap from someone who already follows: delivered right away", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    await processor()(openingTap());
    expect(sentLink()).toBe(1);
    expect(h.sendButtonTemplate).not.toHaveBeenCalled();
  });

  it("opening tap with unknown status: neutral follow prompt, not an error", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "UNKNOWN", reason: "meta_error_100" });
    await processor()(openingTap());
    expect(sentLink()).toBe(0);
    expect(promptTexts()).toEqual([campaign.followPromptMessage]);
  });

  it("tap from someone with no entry in this campaign is ignored", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    await processor()({ ...retryTap(), data: { ...retryTap().data, userId: "stranger" } });
    expect(h.checkUserFollowsBusiness).not.toHaveBeenCalled();
    expect(sentLink()).toBe(0);
  });

  it("read fallback never releases a strict campaign", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    await processor()(tap("reveal:auto_gollab", { fallback: true }));
    expect(h.checkUserFollowsBusiness).not.toHaveBeenCalled();
    expect(sentLink()).toBe(0);
  });

  it("uncertain delivery keeps the claim and is never resent", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    h.sendDirectMessageWithLinkButton.mockRejectedValueOnce(new Error("socket hang up"));
    const run = processor();
    await expect(run(retryTap("mid_1"))).rejects.toThrow();
    expect(h.claims.has(strictDeliveryClaimId("auto_gollab", USER))).toBe(true);
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "FAILED", dmDeliveryUnconfirmed: true }),
      })
    );
    h.redis.clear();
    await run(retryTap("mid_2"));
    expect(sentLink()).toBe(1); // only the original attempt
  });

  it("confirmed rejection releases the claim so a retry can deliver", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "FOLLOWS" });
    h.sendDirectMessageWithLinkButton.mockRejectedValueOnce(
      new MetaApiError(10, undefined, undefined, "outside of allowed window")
    );
    await expect(processor()(retryTap("mid_1"))).rejects.toThrow();
    expect(h.claims.has(strictDeliveryClaimId("auto_gollab", USER))).toBe(false);
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "FAILED", dmDeliveryUnconfirmed: false }),
      })
    );
  });
});

describe("strict follow gate — comment entry", () => {
  const comment: AnyJob = {
    name: "process-comment",
    id: "comment_job",
    attemptsMade: 0,
    data: {
      instagramAccountId: "ig_business",
      commentId: "comment_1",
      commentText: "ANÁLISE",
      commenterId: USER,
      commenterName: "fan",
      mediaId: "media_1",
    },
  };

  it("sends the opening DM, then the public reply only after it was sent", async () => {
    const order: string[] = [];
    h.sendPrivateReplyWithButton.mockImplementation(async () => {
      order.push("dm");
      return { message_id: "m" };
    });
    h.sendCommentReply.mockImplementation(async () => {
      order.push("public");
      return { id: "r" };
    });
    await processor()(comment);

    expect(order).toEqual(["dm", "public"]);
    const [, , , , label, payload] = h.sendPrivateReplyWithButton.mock.calls[0];
    expect(label).toBe("Me envie a análise");
    expect(payload).toBe("followcheck:auto_gollab:open");
    // No follow lookup at comment time: a comment grants no profile consent.
    expect(h.checkUserFollowsBusiness).not.toHaveBeenCalled();
  });

  it("no public reply when the opening DM failed", async () => {
    h.sendPrivateReplyWithButton.mockRejectedValue(
      new MetaApiError(100, undefined, undefined, "The comment is invalid for a private reply")
    );
    await expect(processor()(comment)).rejects.toThrow();
    expect(h.sendCommentReply).not.toHaveBeenCalled();
  });

  it("without an opening DM, the private reply is the follow prompt with both buttons", async () => {
    h.prisma.automation.findMany.mockResolvedValue([
      { ...campaign, openingDmEnabled: false, openingDmMessage: null, openingDmButtonLabel: null },
    ]);
    await processor()(comment);
    const [, , recipient, text, buttons] = h.sendButtonTemplate.mock.calls[0];
    expect(recipient).toEqual({ comment_id: "comment_1" });
    expect(text).toBe(campaign.followPromptMessage);
    expect(buttons.map((b: { type: string }) => b.type)).toEqual(["postback", "web_url"]);
    expect(h.checkUserFollowsBusiness).not.toHaveBeenCalled();
  });
});

describe("strict follow gate — cooldown scope", () => {
  it("an 'I'm following' tap right after the opening tap is still answered", async () => {
    h.checkUserFollowsBusiness.mockResolvedValue({ state: "NOT_FOLLOWING" });
    const run = processor();
    await run(openingTap("mid_open"));
    await run(retryTap("mid_retry"));
    expect(h.checkUserFollowsBusiness).toHaveBeenCalledTimes(2);
    expect(promptTexts()).toEqual([campaign.followPromptMessage, "NAO_SEGUE_TEXTO"]);
  });
});
