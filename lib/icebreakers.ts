/**
 * Ice breakers: the ready-made questions Instagram shows when someone opens a
 * DM with the account for the first time (mobile app only). The questions and
 * their answers live in config/icebreakers.json, keyed by account username;
 * scripts/publicar-icebreakers.ts publishes the questions to Instagram, and
 * the worker answers a tap (postback payload `ib:<key>`).
 */
import config from "@/config/icebreakers.json";

export interface IceBreaker {
  key: string;
  question: string;
  answer: string;
  buttonLabel?: string;
  url?: string;
}

export const ICE_BREAKER_PREFIX = "ib:";

export function iceBreakersFor(username: string): IceBreaker[] {
  const list = (config as unknown as Record<string, unknown>)[username];
  return Array.isArray(list) ? (list as IceBreaker[]).slice(0, 4) : [];
}

export function findIceBreaker(username: string, payload: string): IceBreaker | null {
  if (!payload.startsWith(ICE_BREAKER_PREFIX)) return null;
  const key = payload.slice(ICE_BREAKER_PREFIX.length);
  return iceBreakersFor(username).find((item) => item.key === key) ?? null;
}

/** Body for POST /{ig-user-id}/messenger_profile. */
export function iceBreakersProfileBody(username: string) {
  return {
    platform: "instagram",
    ice_breakers: [
      {
        // Meta requires (call_to_actions, locale) together; "default" covers
        // every language the viewer may use.
        locale: "default",
        call_to_actions: iceBreakersFor(username).map((item) => ({
          question: item.question,
          payload: `${ICE_BREAKER_PREFIX}${item.key}`,
        })),
      },
    ],
  };
}
