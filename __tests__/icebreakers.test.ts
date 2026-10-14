import { describe, it, expect } from "vitest";
import { findIceBreaker, iceBreakersFor, iceBreakersProfileBody } from "@/lib/icebreakers";

describe("icebreakers", () => {
  it("has at most 4 questions for the account (Meta's limit)", () => {
    const items = iceBreakersFor("gollab.com.br");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
  });

  it("builds the messenger_profile body with locale + call_to_actions", () => {
    const body = iceBreakersProfileBody("gollab.com.br");
    expect(body.platform).toBe("instagram");
    expect(body.ice_breakers[0].locale).toBe("default");
    expect(body.ice_breakers[0].call_to_actions[0]).toEqual({
      question: "O que tem no site do GOL LAB?",
      payload: "ib:site",
    });
  });

  it("finds the answer for a tap and ignores other payloads", () => {
    expect(findIceBreaker("gollab.com.br", "ib:youtube")?.url).toBe("https://www.youtube.com/@gollabcombr");
    expect(findIceBreaker("gollab.com.br", "followcheck:x")).toBeNull();
    expect(findIceBreaker("outra.conta", "ib:site")).toBeNull();
  });
});
