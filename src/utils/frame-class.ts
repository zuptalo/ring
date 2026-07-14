/**
 * Per-recipient frame classification + conversation route ids (spec 1050).
 *
 * The server relays sealed frames it cannot read, so the SENDER labels each
 * copy with a coarse plaintext class and an opaque conversation route id; the
 * recipient's push-routing prefs then gate the wake server-side (see
 * specs/1050-quiet-housekeeping-frames/contracts/push-routing.md). Pure module:
 * every send site in queries.ts threads these results onto outgoing frames, and
 * the tables here are the unit-tested source of truth.
 */
import type { Message } from '@/db/types';
import type { MessagePayload } from '@/services/crypto/message';

/** Coarse push classes — must stay in lockstep with the server's AllowPush. */
export type FrameClass =
  | 'message'
  | 'mention'
  | 'reaction'
  | 'activity'
  | 'game'
  | 'post'
  | 'housekeeping';

/** Class of an ordinary group message for ONE recipient: personally-directed
 *  frames (an @mention of them, an @everyone, or a reply quoting their message)
 *  are `mention` — the class that pierces mutes server-side, mirroring the
 *  on-device escalation (specs 1020/1048). Receive-side validation of @everyone
 *  (owner-only) is unchanged; classing a forged broadcast `mention` merely fails
 *  to wake quieter than today, never louder than a plain message wake.
 */
export function classifyGroupMessage(member: string, payload: MessagePayload): FrameClass {
  if (payload.mentionsEveryone) return 'mention';
  if (payload.mentions?.includes(member)) return 'mention';
  if (payload.reply?.senderId === member) return 'mention';
  return 'message';
}

/** Class of a reaction signal for ONE recipient: the reacted-to author and
 *  members with their OWN prior reaction on the target are loud (`reaction`);
 *  everyone else syncs passively (`housekeeping`). Removals are housekeeping
 *  for all — nobody is woken for an un-heart (spec 1050 US1). The sender's own
 *  reactions never make anyone loud.
 */
export function classifyReactionRecipient(
  member: string,
  target: Pick<Message, 'senderId' | 'reactions'>,
  remove: boolean,
  selfId: string,
): FrameClass {
  if (remove) return 'housekeeping';
  if (target.senderId === member) return 'reaction';
  if ((target.reactions ?? []).some((r) => r.userId === member && r.userId !== selfId)) return 'reaction';
  return 'housekeeping';
}

/** Mint a conversation route id: 16 random bytes, unpadded base64url. Random ⇒
 *  the server can cluster a conversation's frames (the approved leak) but derive
 *  nothing about it. */
export function mintPrid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Converge two candidate prids: the lexicographically smaller wins, so both
 *  sides of a double-mint (each end's first up-to-date send raced) settle on
 *  the same id without coordination. */
export function adoptPrid(current: string | undefined, incoming: string | undefined): string | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  return incoming < current ? incoming : current;
}
