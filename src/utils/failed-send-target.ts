// (spec 2053) Which failed outgoing message the "couldn't be sent" banner should jump to when
// tapped. Pure + dependency-free so the hidden-chat carve-out — the privacy-sensitive rule — is
// unit-testable without the app shell.
//
// Rule: jump to the MOST RECENT failure whose chat is NOT hidden. A hidden chat is deliberately
// excluded so the banner never navigates into (or hints at the existence of) a hidden
// conversation — when every failure is hidden, there is no target and the banner stays purely
// informative (no tap handler). `isHidden` is injected (the app passes the same predicate the
// router guard uses) so this file needs no crypto/state import.

export interface FailedSendItem {
  id: string;
  chatId?: string;
  timestamp?: number;
}

export interface JumpTarget {
  chatId: string;
  messageId: string;
}

export function pickFailedJumpTarget(
  items: FailedSendItem[],
  isHidden: (chatId: string) => boolean,
): JumpTarget | undefined {
  const openable = items
    .filter((m): m is FailedSendItem & { chatId: string } => !!m.chatId && !isHidden(m.chatId))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const m = openable[0];
  return m ? { chatId: m.chatId, messageId: m.id } : undefined;
}
