/**
 * Strict follow gate: the release rule, kept free of I/O so it can be tested.
 *
 * Only a confirmed follow releases the link. "Not following" and "could not
 * tell" are different outcomes with different messages, and neither releases
 * anything. A tap on "I'm following" is a request to check, never proof.
 */
import type { FollowCheckOutcome, TemplateButton } from "@/lib/meta/client";

/** Where a check came from. */
export type GateSource =
  // Tap on the opening DM button ("Me envie o conteúdo").
  | "OPENING_TAP"
  // Tap on the follow prompt's own "I'm following" button.
  | "RETRY_TAP"
  // Delayed re-check queued after a negative or unknown retry tap.
  | "RECHECK"
  // Inbound DM matching the campaign keywords (DM trigger).
  | "DM";

export type GateAction =
  | { kind: "DELIVER" }
  | {
      kind: "PROMPT";
      message: "follow" | "not_following" | "unknown";
      scheduleRecheck: boolean;
    }
  | { kind: "SCHEDULE_RECHECK" }
  | { kind: "STOP" };

export function decideGateAction({
  source,
  outcome,
  rechecksRemaining,
}: {
  source: GateSource;
  outcome: FollowCheckOutcome;
  rechecksRemaining: boolean;
}): GateAction {
  if (outcome.state === "FOLLOWS") return { kind: "DELIVER" };

  // Background re-checks never message anyone: the person already got the
  // answer to their tap. They only deliver if the follow shows up late.
  if (source === "RECHECK") {
    return rechecksRemaining ? { kind: "SCHEDULE_RECHECK" } : { kind: "STOP" };
  }

  // First contact. The person has not claimed to follow yet, so an unknown
  // status is not an error worth reporting: just ask them to follow.
  if (source === "OPENING_TAP" || source === "DM") {
    return { kind: "PROMPT", message: "follow", scheduleRecheck: false };
  }

  // RETRY_TAP: they say they follow. Instagram can take up to about a minute
  // to report a brand-new follow, so answer now and keep looking quietly.
  return {
    kind: "PROMPT",
    message: outcome.state === "NOT_FOLLOWING" ? "not_following" : "unknown",
    scheduleRecheck: rechecksRemaining,
  };
}

/** Payloads carried by the gate's postback buttons. */
export function parseGatePayload(
  payload: string
): { automationId: string; fromOpeningDm: boolean } | null {
  if (!payload.startsWith("followcheck:")) return null;
  const [automationId, marker] = payload.slice("followcheck:".length).split(":");
  if (!automationId) return null;
  return { automationId, fromOpeningDm: marker === "open" };
}

export function profileUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

export const DEFAULT_GATE_TEXT = {
  followPrompt: (account: string) =>
    `Para receber o conteúdo, siga @${account} e depois toque em ‘Já estou seguindo’ aqui embaixo.`,
  followButton: "Já estou seguindo",
  notFollowing: (account: string) =>
    `Ainda não consegui confirmar que você segue @${account}. Siga o perfil e toque no botão para verificar novamente.`,
  unknown:
    "Não consegui verificar agora. Aguarde um pouco e toque no botão para tentar novamente.",
  delivery: "Tudo certo! Aqui está o conteúdo que você pediu.",
  alreadyDelivered:
    "Você já recebeu esse conteúdo aqui na conversa. É só rolar a tela para cima.",
  deliveryButton: "Acessar conteúdo",
} as const;

/**
 * The follow prompt's buttons: the check, plus an optional link that only
 * opens the profile (Instagram has no button that follows on tap).
 */
export function buildGateButtons({
  automationId,
  checkLabel,
  profileLabel,
  accountUsername,
}: {
  automationId: string;
  checkLabel: string | null | undefined;
  profileLabel: string | null | undefined;
  accountUsername: string;
}): TemplateButton[] {
  const buttons: TemplateButton[] = [
    {
      type: "postback",
      title: checkLabel?.trim() || DEFAULT_GATE_TEXT.followButton,
      payload: `followcheck:${automationId}`,
    },
  ];
  if (profileLabel?.trim()) {
    buttons.push({
      type: "web_url",
      title: profileLabel.trim(),
      url: profileUrl(accountUsername),
    });
  }
  return buttons;
}

export function gatePromptText(
  message: "follow" | "not_following" | "unknown",
  automation: {
    followPromptMessage: string | null;
    followNotFollowingMessage: string | null;
    followUnknownMessage: string | null;
  },
  accountUsername: string
): string {
  if (message === "follow")
    return (
      automation.followPromptMessage?.trim() ||
      DEFAULT_GATE_TEXT.followPrompt(accountUsername)
    );
  if (message === "not_following")
    return (
      automation.followNotFollowingMessage?.trim() ||
      DEFAULT_GATE_TEXT.notFollowing(accountUsername)
    );
  return automation.followUnknownMessage?.trim() || DEFAULT_GATE_TEXT.unknown;
}
