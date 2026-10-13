import { describe, it, expect, vi, afterEach } from "vitest";
import { checkUserFollowsBusiness } from "@/lib/meta/client";
import { decideGateAction, buildGateButtons } from "@/lib/follow-gate/decision";

// The strict check must turn every non-answer into UNKNOWN, never into a
// "not following" or a "follows".

function respond(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("checkUserFollowsBusiness", () => {
  it("true → FOLLOWS", async () => {
    vi.stubGlobal("fetch", respond(200, { is_user_follow_business: true, id: "1" }));
    expect(await checkUserFollowsBusiness("t", "1")).toEqual({ state: "FOLLOWS" });
  });

  it("false → NOT_FOLLOWING", async () => {
    vi.stubGlobal("fetch", respond(200, { is_user_follow_business: false, id: "1" }));
    expect(await checkUserFollowsBusiness("t", "1")).toEqual({ state: "NOT_FOLLOWING" });
  });

  it("field missing → UNKNOWN field_missing", async () => {
    vi.stubGlobal("fetch", respond(200, { id: "1" }));
    expect(await checkUserFollowsBusiness("t", "1")).toEqual({
      state: "UNKNOWN",
      reason: "field_missing",
    });
  });

  it("non-boolean value → UNKNOWN", async () => {
    vi.stubGlobal("fetch", respond(200, { is_user_follow_business: "true" }));
    expect((await checkUserFollowsBusiness("t", "1")).state).toBe("UNKNOWN");
  });

  it("consent error → UNKNOWN with Meta's code, no token or message leaked", async () => {
    vi.stubGlobal(
      "fetch",
      respond(400, {
        error: { message: "User consent is required", code: 230, type: "IGApiException", fbtrace_id: "x" },
      })
    );
    const out = await checkUserFollowsBusiness("secret_token", "1");
    expect(out).toEqual({ state: "UNKNOWN", reason: "meta_error_230" });
    expect(JSON.stringify(out)).not.toContain("secret_token");
  });

  it("HTTP 500 with invalid body → UNKNOWN", async () => {
    vi.stubGlobal("fetch", respond(500, "<html>oops"));
    expect((await checkUserFollowsBusiness("t", "1")).state).toBe("UNKNOWN");
  });

  it("network failure → UNKNOWN network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await checkUserFollowsBusiness("t", "1")).toEqual({ state: "UNKNOWN", reason: "network" });
  });

  it("timeout → UNKNOWN timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason));
          })
      )
    );
    expect(await checkUserFollowsBusiness("t", "1", 20)).toEqual({ state: "UNKNOWN", reason: "timeout" });
  });

  it("sends the token in the header, never in the URL", async () => {
    const fetchMock = respond(200, { is_user_follow_business: true });
    vi.stubGlobal("fetch", fetchMock);
    await checkUserFollowsBusiness("secret_token", "123");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("secret_token");
    expect(url).toContain("fields=is_user_follow_business");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret_token");
  });
});

describe("decideGateAction", () => {
  const unknown = { state: "UNKNOWN", reason: "x" } as const;
  it("only FOLLOWS delivers, from any source", () => {
    for (const source of ["OPENING_TAP", "RETRY_TAP", "RECHECK", "DM"] as const) {
      expect(decideGateAction({ source, outcome: { state: "FOLLOWS" }, rechecksRemaining: true }))
        .toEqual({ kind: "DELIVER" });
      expect(decideGateAction({ source, outcome: unknown, rechecksRemaining: true }).kind)
        .not.toBe("DELIVER");
      expect(decideGateAction({ source, outcome: { state: "NOT_FOLLOWING" }, rechecksRemaining: true }).kind)
        .not.toBe("DELIVER");
    }
  });

  it("distinguishes not following from unknown on a retry tap", () => {
    expect(decideGateAction({ source: "RETRY_TAP", outcome: { state: "NOT_FOLLOWING" }, rechecksRemaining: true }))
      .toEqual({ kind: "PROMPT", message: "not_following", scheduleRecheck: true });
    expect(decideGateAction({ source: "RETRY_TAP", outcome: unknown, rechecksRemaining: false }))
      .toEqual({ kind: "PROMPT", message: "unknown", scheduleRecheck: false });
  });

  it("re-checks never message", () => {
    expect(decideGateAction({ source: "RECHECK", outcome: unknown, rechecksRemaining: true }))
      .toEqual({ kind: "SCHEDULE_RECHECK" });
    expect(decideGateAction({ source: "RECHECK", outcome: { state: "NOT_FOLLOWING" }, rechecksRemaining: false }))
      .toEqual({ kind: "STOP" });
  });
});

describe("buildGateButtons", () => {
  it("profile button only opens the profile URL", () => {
    expect(
      buildGateButtons({ automationId: "a", checkLabel: "", profileLabel: "Abrir perfil", accountUsername: "gollab.com.br" })
    ).toEqual([
      { type: "postback", title: "Já estou seguindo", payload: "followcheck:a" },
      { type: "web_url", title: "Abrir perfil", url: "https://www.instagram.com/gollab.com.br/" },
    ]);
  });
  it("no profile label → single check button", () => {
    expect(buildGateButtons({ automationId: "a", checkLabel: "X", profileLabel: null, accountUsername: "u" }))
      .toHaveLength(1);
  });
});
