/**
 * Service-worker background decryption for rich notifications.
 *
 * Two modes since spec 1032 (specs/1032-store-messages-push/):
 *   - AUTHORITATIVE (sw-drain.ts, behind the internal `sw.fullPersist` flag):
 *     eligible plain messages are decrypted, PERSISTED atomically, and acked at
 *     notification time, so the app opens warm. sw-drain reuses this module's
 *     fetch + note-building helpers, so notification content and privacy rules
 *     are identical in both modes.
 *   - PREVIEW (this module, the original "Choice A"): woken by a content-free
 *     push tickle, the SW fetches the queued E2EE frames over HTTP, decrypts
 *     them READ-ONLY (previewPacket never persists the ratchet or acks), and
 *     builds notification previews. The page still drains + persists for real
 *     over its WebSocket on next open. This remains the whole story for: the
 *     flag off, PIN/passkey-locked devices, frame types the drain defers
 *     (first-contact, cards, reactions, controls), and every degrade path.
 * Only a content-free tickle ever flows through Apple/Google in either mode.
 *
 * Mirrors the live page dispatch (db/queries.ts `receiveIncoming` → services/notify
 * `notifyIncoming`): plain messages honor `notifications.message.show`, while
 * friend requests / group invites always surface. Notes for the same conversation
 * are aggregated (one updating notification with a count), so a backlog doesn't
 * collapse to "just the last message" or stack N separate banners.
 *
 * Import-clean for the SW: depends only on idb, the crypto/decrypt path, and the
 * IDB-backed session token (no DOM / Ionic / page-only modules).
 */
import { attemptDeviceUnlock, getIdentityKeys } from './crypto/identity';
import { ready as sodiumReady } from './crypto/primitives';
import { openPostEngagement, openReceivedPost } from './posts';
import { previewPacket } from './messaging';
import { readHiddenSet, readHiddenSetOrNull } from './hidden-chats';
import { readSessionToken, readSessionUserId } from './session';
import { get, getAll, put } from '@/db/idb';
import { notifyPreview } from '@/utils/notify-preview';
import { GAMES } from '@/games/registry';
import { applySignal as applyGameSignal, deriveStatus as deriveGameStatus } from '@/games/session';
import { playerIndexOf, lockOpponent, buildWallSession, challengePhase, type WallGameRow } from '@/games/challenge';
import type { Chat, Contact, Message, Setting } from '@/db/types';
import type { MessagePayload, CallEventSignal } from './crypto/message';
import {
  RING_WINDOW_MS,
  applyCallTickle,
  applyCallOutcome,
  sweepStaleUnits,
  type CallBadgeUnit,
  type RingShownSig,
} from './call-events';

// Same-origin by default (the dev proxy / prod reverse-proxy route /v1 → backend).
// VITE_API_URL is baked in only when targeting a different backend host.
const API = `${import.meta.env.VITE_API_URL ?? ''}/v1`;

// Exported (spec 1032): sw-drain.ts drains the same queue authoritatively.
export interface MsgFrame {
  t: string;
  id?: string;
  from?: string;
  ciphertext?: unknown;
}

/** A ready-to-show notification. `ids` are the relay frame ids this note covers
 *  (more than one when several messages from the same conversation are merged);
 *  the caller marks them all shown after displaying so none re-notifies. */
export interface SwNote {
  ids: string[];
  title: string;
  body: string;
  url: string;
  tag: string;
  // (spec 2017) The count to render in the title (e.g. "Alice (3)"). Carried separately from `title`
  // so the show path can make it CUMULATIVE across overlapping burst wakes (via the persisted
  // per-chat summary) instead of a per-pass slice. Defaults to ids.length when unset.
  count?: number;
  // (spec 1048) Show without the platform alert sound. A SW can't play the app's
  // synthesized tones, so the reaction tone 'none' maps to this — the note is still
  // VISIBLE (the wake ends visibly either way); only the sound is dropped.
  silent?: boolean;
}

/** Background-preview result. `notes` are the displayable notifications, `pending`
 *  is the number of queued (undelivered) message frames, known from the fetch
 *  alone (no decryption needed) and used for the app-icon badge. `suppressed` is
 *  set when there was something to alert but the user's "Show notifications" toggle
 *  withheld it, so the caller skips the generic placeholder rather than showing
 *  "New message" the user asked not to see. */
export interface PreviewResult {
  notes: SwNote[];
  pending: number;
  // Call-event markers decrypted this pass (spec 1040): the caller (sw.ts)
  // applies their badge-unit transitions and, on an 'answered' outcome, closes
  // the stale ring notification. The missed/cancelled NOTIFICATION itself rides
  // `notes` like any other (tag 'ring-call' so it REPLACES the ring alert).
  callEvents?: CallEventSignal[];
  // The pending count the app-icon BADGE may use (spec 1027, B4): equal to
  // `pending` under badge mode 'always'; under 'never'/'revealed' only frames
  // that decrypted AND resolved to a provably NON-hidden chat. A frame we can't
  // classify (undecryptable, already-shown, unknown chat) is never counted —
  // privacy beats accuracy on the badge when the user opted hidden chats out.
  badgePending: number;
  // suppressed: there was something to alert on but the user's global "Show
  // notifications" toggle withheld it → caller skips the generic placeholder AND
  // doesn't badge (nothing to count for the user).
  suppressed: boolean;
  // silenced: every notifiable message was INTENTIONALLY silenced by per-chat prefs
  // (mute / web-push-off / content=none) and nothing else needs surfacing → caller
  // shows NO notification (not even the generic placeholder), but STILL badges the
  // pending count (spec 1015 FR-022/FR-024: "badge only"). Distinct from `suppressed`
  // so the badge keeps updating, and from a cold-start undecryptable frame (which
  // still gets a generic placeholder to honor the Web Push userVisibleOnly contract).
  silenced: boolean;
  // (spec 2014 US2) When we end up with NO decrypted notes and fall back to the generic placeholder,
  // why? — 'relay-<status>' / 'relay-error' (couldn't fetch the queue), 'locked' (device unlock
  // failed), 'decrypt-failed' (frames fetched but none decryptable). Surfaced ONLY on the dev
  // deployment to diagnose the "generic after a while" regression on-device; never shown in prod.
  reason?: string;
  // (spec 2016) Is there a GENUINELY-NEW message we couldn't render — a fetched-but-undecryptable
  // frame, a locked device with pending frames, or a fetch we couldn't even make — so the caller
  // SHOULD show the generic placeholder? FALSE when there was nothing genuinely new (the relay queue
  // was empty, or every fetched frame was already shown): the caller must NOT show a new placeholder
  // for those (pure noise — the burst extra-generic / `no-frames` toggle noise). Distinct from
  // `reason`, which only labels WHY a fallback happened for the dev diagnostic.
  newUnshown: boolean;
}

/** Read a settings-store value from the service worker (no keystore needed; settings
 *  are stored in the clear). Exported so the SW push handler can honor notification
 *  toggles like `notifications.wall.show`. */
/** (spec 1037) Stamp the wall-clock of a push WAKE. The page compares this
 *  against stale-drained messages: a long-queued message with NO wake after
 *  its send time is the zombie-subscription signature that triggers rotation. */
export async function stampPushWake(): Promise<void> {
  try {
    await put<Setting<number>>('settings', { key: 'push.lastWakeAt', value: Date.now() });
  } catch {
    /* best-effort */
  }
}

/** (spec 2043) The per-event outcome of a single push wake. Both bits are scoped
 *  to ONE event — never a module global — which is the whole fix: pre-2043 a shared
 *  "last shown" stamp let a later event's accepted show bleed past an earlier
 *  event's start and suppress its fallback, ending that earlier wake silently (an
 *  iOS subscription strike). */
export interface WakeCtx {
  /** An OS notification was actually accepted DURING this event. Gates the
   *  reject/timeout fallback: fall back unless this specific event showed. */
  shown: boolean;
  /** Shown, OR silence was licensed for this wake (`mayEndWakeSilently`). Gates the
   *  clean-resolve backstop: a wake that resolves neither shown nor licensed is a
   *  silent push and must show a backstop generic. */
  satisfied: boolean;
}

/** (spec 2043) The deadline message; also the reason token the guard surfaces so a
 *  hung handler is distinguishable from a thrown one in the fallback body/ledger. */
export const PUSH_DEADLINE_MESSAGE = 'push handler exceeded deadline';

/** (spec 2043) The coarse, content-free outcome of a guarded wake. */
export interface WakeResult {
  /** An OS notification was accepted this event. */
  shown: boolean;
  /** Shown or licensed-silent — the wake ended acceptably (no backstop needed). */
  satisfied: boolean;
  /** The last-resort backstop generic fired (the primary path showed nothing). */
  fellBack: boolean;
}

/** (spec 2043) Run one push wake under a per-event guard. `dispatch` mutates its
 *  own `WakeCtx` as it shows / licenses silence; `showFallback` is the last-resort
 *  visible generic. The Web Push `userVisibleOnly` contract is unforgiving on iOS —
 *  a push event that resolves without a visible notification is a silent push, and
 *  a few of those revoke the subscription — so this guarantees EVERY wake ends
 *  either shown or with licensed silence:
 *    - clean resolve, not satisfied → backstop generic (the always-visible invariant
 *      becomes enforced, not merely assumed by each terminal).
 *    - reject / deadline, not shown → last-resort generic (per-event, so a sibling
 *      wake's show can't suppress it — the 2043 stamp-bleed regression).
 *  A fallback that itself fails is swallowed (the platform denied even the generic;
 *  nothing more we can do). Kept pure + injectable here so it is unit-testable
 *  without the `self`-bound service-worker module. */
export async function runGuardedWake(
  dispatch: (ctx: WakeCtx) => Promise<void>,
  showFallback: (reason: string) => Promise<void>,
  deadlineMs: number,
): Promise<WakeResult> {
  const ctx: WakeCtx = { shown: false, satisfied: false };
  let fellBack = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallback = async (reason: string): Promise<void> => {
    fellBack = true;
    try {
      await showFallback(reason);
    } catch {
      /* the platform denied even the bare fallback — nothing more we can do */
    }
  };
  try {
    await Promise.race([
      dispatch(ctx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(PUSH_DEADLINE_MESSAGE)), deadlineMs);
      }),
    ]);
    if (!ctx.satisfied) await fallback('clean-resolve-no-show');
  } catch (err) {
    if (!ctx.shown) await fallback(`fallback: ${String((err as Error)?.message ?? err)}`);
  } finally {
    // Clear the loser of the race so a still-pending deadline reject can't surface
    // as an unhandled rejection after dispatch already settled.
    if (timer !== undefined) clearTimeout(timer);
  }
  return { shown: ctx.shown, satisfied: ctx.satisfied, fellBack };
}

/* ---- (spec 2043) On-device push-wake ledger. A bounded, ZERO-KNOWLEDGE ring buffer
 * of what each push wake did — enum kind, enum outcome, a count, a timestamp. NO
 * sender, body, or tag ever enters it, so it is safe to surface on a real production
 * device (behind the diagnostics toggle) to see WHY notifications fell silent, which
 * is otherwise invisible on iOS. ---- */
export type WakeKind = 'call' | 'conn' | 'post' | 'post-activity' | 'version' | 'msg';
export type WakeOutcome = 'shown' | 'licensed-silent' | 'fallback';
export interface WakeLedgerEntry { ts: number; kind: WakeKind; outcome: WakeOutcome; count: number }
const WAKE_LEDGER_KEY = 'push.wakeLedger';
const WAKE_LEDGER_MAX = 50;

/** Append one content-free wake outcome, capped at the newest WAKE_LEDGER_MAX.
 *  Best-effort telemetry — never blocks or fails the alert. */
export async function recordWake(kind: WakeKind, outcome: WakeOutcome, count = 0): Promise<void> {
  try {
    const prev = (await get<Setting<WakeLedgerEntry[]>>('settings', WAKE_LEDGER_KEY))?.value ?? [];
    const next = [...prev, { ts: Date.now(), kind, outcome, count }].slice(-WAKE_LEDGER_MAX);
    await put<Setting<WakeLedgerEntry[]>>('settings', { key: WAKE_LEDGER_KEY, value: next });
  } catch {
    /* best-effort */
  }
}

/** Read the wake ledger (newest last) for the diagnostics view. */
export async function readWakeLedger(): Promise<WakeLedgerEntry[]> {
  return (await get<Setting<WakeLedgerEntry[]>>('settings', WAKE_LEDGER_KEY))?.value ?? [];
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const s = await get<Setting<T>>('settings', key);
  return s ? s.value : fallback;
}

/** The 1:1 chat id used as the ratchet-session key for `from` (or a synthetic key
 *  when no chat exists yet, a prekey preamble then establishes the session in
 *  memory for the preview). Mirrors startDirectChat by preferring a non-pending
 *  (visible) chat when a peer somehow has more than one 1:1 chat. */
function sessionKeyForPeer(chats: Chat[], from: string): string {
  const mine = chats.filter((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
  return (mine.find((c) => !c.pending) ?? mine[0])?.id ?? from;
}

// The SW doesn't ack, so an unprocessed frame reappears on the next push until the
// page drains it. Track shown message ids so we don't re-notify, expiring entries by
// AGE rather than a fixed count: a high-volume conversation could otherwise evict a
// recently-shown id (the old 1000-count cap) before the page acks it, re-notifying
// it. 48h comfortably outlives the gap between a push and the next app open. A large
// safety cap still bounds storage in a pathological burst.
const SHOWN_KEY = 'swNotifiedIds';
const SHOWN_TTL_MS = 48 * 60 * 60 * 1000;
const SHOWN_MAX = 2000;

// Upper bound on the /relay/pending fetch when the SW wakes for a push, so a slow or
// unresponsive server can't hang the handler (the caller falls back to a generic
// placeholder, then upgrades if the fetch lands within the outer settle window).
const PENDING_FETCH_TIMEOUT_MS = 8000;
type ShownEntry = { id: string; ts: number };

async function loadShownEntries(): Promise<ShownEntry[]> {
  const raw = await setting<Array<ShownEntry | string>>(SHOWN_KEY, []);
  const cutoff = Date.now() - SHOWN_TTL_MS;
  const out: ShownEntry[] = [];
  for (const e of raw) {
    // Tolerate the legacy string[] shape from before time-based expiry: keep them,
    // stamped now, so an upgrade doesn't immediately re-notify recent messages.
    if (typeof e === 'string') out.push({ id: e, ts: Date.now() });
    else if (e && e.ts >= cutoff) out.push(e);
  }
  return out;
}
/** Frame ids already SHOWN as notifications (TTL-pruned). Exported for sw-drain's
 *  re-ack path (spec 1032): a committed-but-never-shown frame gets its note rebuilt
 *  on redelivery, and this ledger is what distinguishes "never shown" from shown. */
export async function loadShown(): Promise<string[]> {
  return (await loadShownEntries()).map((e) => e.id);
}

/** Build the raw (un-aggregated) note for one decrypted frame, or null when the
 *  frame carries nothing to alert on (reactions, votes, silent membership/profile
 *  side effects). Mirrors db/queries.ts `receiveIncoming` + the notifyIncoming
 *  calls it makes: requests/invites always notify; plain messages honor showMessages. */
// Exported for unit tests (spec 1019 hidden-chat generic rendering, spec 1015
// content prefs). Otherwise internal to `previewPending`.
export function noteForPayload(
  f: MsgFrame,
  payload: MessagePayload,
  chats: Chat[],
  contacts: Contact[],
  showMessages: boolean,
  showPreview: boolean,
  hidden: Set<string> = new Set(),
  selfId = '',
  // Game context, prefetched by previewPending (spec 0008 T041 / spec 0009 US2):
  // the target's stored row (winner naming + group seat mapping), the device's
  // game-notification prefs, and its private follow set.
  gameCtx?: {
    row?: Message;
    prefs?: { turn: boolean; challenges: boolean; followMoves: boolean; followResults: boolean };
    follows?: Record<string, number>;
  },
  // Reaction context (spec 1048), prefetched by previewPending: the reacted-to
  // message's stored row (to tell "reaction to MY message" and quote it) plus the
  // gating toggles and the dedicated reaction tone. Absent (e.g. a caller that
  // defers reactions, like the authoritative drain) → the reaction stays the
  // silent side effect it was before spec 1048.
  reactionCtx?: {
    row?: Message;
    prefs?: { dm: boolean; group: boolean; tone: string };
  },
  // Surface masters (spec 1050): the group "Show notifications" toggle finally
  // gates group frames here too. Like the global master, escalation does NOT
  // pierce it. Absent = on (old callers).
  surfaces?: { showGroups?: boolean },
): { note: SwNote | null; wasMessage: boolean; silenced?: boolean } {
  const showGroups = surfaces?.showGroups !== false;
  const from = f.from as string;
  const known = contacts.find((c) => c.id === from)?.name;

  // Friend request (ContactCard 'request') always surfaces, like the live path.
  if (payload.card) {
    if (payload.card.t !== 'request') return { note: null, wasMessage: false };
    const name = known || payload.card.name || 'Someone';
    return {
      note: { ids: [f.id as string], title: name, body: 'wants to connect', url: '/tabs/contacts', tag: `ring:req:${from}` },
      wasMessage: false,
    };
  }
  // Group invite (GroupCard 'invite') always surfaces. Other membership cards
  // (create/update/leave/accept/decline) are silent side effects.
  if (payload.group) {
    if (payload.group.t !== 'invite') return { note: null, wasMessage: false };
    const inviter = known || 'Someone';
    const groupName = payload.group.name || 'a group';
    return {
      note: {
        ids: [f.id as string],
        title: inviter,
        body: `invited you to "${groupName}"`,
        url: '/tabs/contacts',
        tag: `ring:ginv:${payload.group.groupId}`,
      },
      wasMessage: false,
    };
  }
  // A game move/resign (spec 0008 US3) is the ONE side-effect signal that
  // notifies — a move demands the opponent's attention — but it sits behind
  // exactly the gates an ordinary message gets (SC-007: hidden chats, mute,
  // per-chat web-push, content prefs, global preview all behave identically).
  // wasMessage stays false: the signal stores no row and never counts unread.
  // (Copy nuance: a game-ENDING move also reads "Your move" here — the SW
  // hasn't applied the move, so it can't know; the page path, which has, uses
  // the precise outcome line.)
  if (payload.gameMove || payload.gameAccept) {
    if (!showMessages) return { note: null, wasMessage: false };
    const row = gameCtx?.row;
    const prefs = gameCtx?.prefs ?? { turn: true, challenges: true, followMoves: true, followResults: true };
    const follows = gameCtx?.follows ?? {};
    const gchat = payload.groupId
      ? chats.find((c) => c.id === payload.groupId && c.isGroup)
      : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
    if (gchat && hidden.has(gchat.id)) {
      return {
        note: { ids: [f.id as string], title: 'Ring', body: 'New message', url: '/tabs/chats', tag: `ring:${gchat.id}` },
        wasMessage: false,
      };
    }
    if (gchat?.mutedUntil && gchat.mutedUntil > Date.now()) return { note: null, wasMessage: false, silenced: true };
    if (gchat?.notifyWebPush === false) return { note: null, wasMessage: false, silenced: true };
    const gcontent = gchat?.notifyContent ?? 'full';
    if (gcontent === 'none') return { note: null, wasMessage: false, silenced: true };
    const gshowText = gcontent === 'full' && showPreview;
    const mover = known || 'Someone';
    // 1:1 (and wall) notifications use the mover as the TITLE, so leading the
    // body with their name repeats it; prefix the name only in a GROUP chat
    // (title = group name). Keeps game lines from reading "iPad iPad made a move".
    const bym = payload.groupId ? `${mover} ` : '';
    const nameOf = (uid: string | undefined): string =>
      !uid ? 'Someone' : uid === selfId ? 'You' : contacts.find((c) => c.id === uid)?.name ?? 'Someone';

    let gline: string | null;
    if (payload.gameAccept) {
      // Only the CHALLENGER cares that someone took the seat (spec 0009 US2).
      if (row?.game?.players?.[0] !== selfId || row.game.players.length !== 1) {
        return { note: null, wasMessage: false };
      }
      if (!prefs.challenges) return { note: null, wasMessage: false, silenced: true };
      gline = `${bym}accepted your challenge 💪 Your move!`;
    } else {
      const sig = payload.gameMove!;
      if (row?.game?.players) {
        // Group/wall challenge session: derive the post-move outcome and MY
        // seat with the same pure engine every device uses (spec 0009).
        let session = row.game;
        if (sig.seq === 1 && sig.opponent && session.players!.length === 1 && playerIndexOf(session, from) === 0) {
          session = lockOpponent(session, sig.opponent);
        }
        const senderIdx = playerIndexOf(session, from);
        if (senderIdx === null) return { note: null, wasMessage: false };
        const after = applyGameSignal(GAMES[session.gameType] ?? null, session, sig, senderIdx).session;
        const st = deriveGameStatus(GAMES[session.gameType] ?? null, after);
        const myIdx = playerIndexOf(after, selfId);
        const winnerLine = (): string | null => {
          if (st.state === 'won' || st.state === 'resigned') {
            const winnerId = after.players?.[st.winner!];
            return winnerId === selfId ? 'You won the game! 🏆' : `${nameOf(winnerId)} won the game 🏆`;
          }
          if (st.state === 'draw') return "It's a draw 🤝";
          return null;
        };
        if (myIdx !== null) {
          // A PLAYER: my turn now, or the result — behind the turn pref.
          if (st.state === 'ongoing') {
            if (st.turn !== myIdx) return { note: null, wasMessage: false };
            if (!prefs.turn) return { note: null, wasMessage: false, silenced: true };
            gline = `${bym}made a move, your turn 😏`;
          } else {
            gline = winnerLine();
          }
        } else {
          // An OBSERVER: silent unless this game is followed (device-local set).
          if (follows[sig.messageId] === undefined) return { note: null, wasMessage: false };
          if (st.state === 'ongoing') {
            if (!prefs.followMoves) return { note: null, wasMessage: false, silenced: true };
            gline = `${bym}made a move 🎲`;
          } else {
            if (!prefs.followResults) return { note: null, wasMessage: false, silenced: true };
            gline = winnerLine();
          }
        }
      } else {
        // 1:1 (spec 0008 T041): name the winner when the stored row lets the
        // engine derive it; a resign always crowns the recipient.
        gline = `${bym}made a move, your turn 😏`;
        if (sig.action === 'resign') {
          gline = `${bym}gave up. You win! 🏆`;
        } else if (row?.game) {
          const gmodule = GAMES[row.game.gameType] ?? null;
          const gme = row.outgoing ? 0 : 1;
          const r = applyGameSignal(gmodule, row.game, sig, (1 - gme) as 0 | 1);
          if (r.outcome === 'applied') {
            const st = deriveGameStatus(gmodule, r.session);
            if (st.state === 'won') gline = st.winner === gme ? 'You won the game! 🏆' : `${bym}won the game 🏆`;
            else if (st.state === 'draw') gline = "It's a draw 🤝";
          }
        }
      }
    }
    if (gline === null) return { note: null, wasMessage: false };
    return {
      note: {
        ids: [f.id as string],
        title: showPreview ? (payload.groupId ? gchat?.name || 'Group' : mover) : 'Ring',
        body: gshowText ? gline : 'New message',
        url: gchat ? `/chat/${gchat.id}` : '/tabs/chats',
        tag: gchat ? `ring:${gchat.id}` : `ring:from:${from}`,
      },
      wasMessage: false,
    };
  }

  // Call lifecycle markers (spec 1040). Only a missed/cancelled outcome shows —
  // it REPLACES the stale "Incoming call" alert via the shared 'ring-call' tag.
  // A ring marker is silent here (the {"t":"call"} wake names the actual ring via
  // previewCallRing) and an 'answered' outcome is silent (sw.ts closes the ring
  // notification from the collected callEvents instead).
  if (payload.callEvent) {
    const ev = payload.callEvent;
    if (ev.phase !== 'ended' || (ev.outcome !== 'missed' && ev.outcome !== 'cancelled')) {
      return { note: null, wasMessage: false };
    }
    const cChat = ev.roomId
      ? chats.find((c) => c.id === ev.roomId && c.isGroup)
      : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
    // Hidden chats: calls are excluded from every at-rest surface (Calls tab,
    // missed badge), so a hidden conversation's missed call shows NOTHING here —
    // even a nameless "Missed call" alert would leak that hidden activity exists.
    if (cChat && hidden.has(cChat.id)) return { note: null, wasMessage: false };
    const caller = known || 'Someone';
    const isGroupCall = !!ev.roomId;
    const title = isGroupCall ? cChat?.name || caller : caller;
    const what = ev.kind === 'video' ? 'Missed video call' : 'Missed call';
    return {
      note: {
        ids: [f.id as string],
        title,
        body: isGroupCall && cChat ? `${what} from ${caller} ☎️` : `${what} ☎️`,
        url: cChat ? `/chat/${cChat.id}` : '/tabs/calls',
        tag: 'ring-call', // replaces the incoming-call alert (FR-012)
      },
      wasMessage: false,
    };
  }

  // Reactions (spec 1048): a reaction ADD to one of MY OWN messages notifies the
  // author (the two settings toggles gate it per surface) — everything else about a
  // reaction stays the silent side effect it always was. Critically for push health
  // (FR-013): every suppressed case below returns the EXACT pre-1048 shape
  // `{note:null, wasMessage:false}`, so sw.ts's established visible-wake fallback
  // (specs 2016/2017/2023) applies unchanged — no new class of silent wake exists.
  // Reactions NEVER escalate (unlike mentions): mute, web-push-off, content='none',
  // hidden, and the global master all silence them. wasMessage stays false — a
  // reaction is not a message and must not badge or count unread (spec 1048
  // clarification).
  if (payload.reaction) {
    const sig = payload.reaction;
    const row = reactionCtx?.row;
    const rChat = payload.groupId
      ? chats.find((c) => c.id === payload.groupId && c.isGroup)
      : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
    const mine = !!row && (row.outgoing || row.senderId === 'me');
    // Group-surface master (spec 1050): a group reaction is a group notice.
    if (payload.groupId && !showGroups) return { note: null, wasMessage: false };
    // spec 1050 (US2): a member with their OWN reaction on the target is a
    // co-reactor — loud too, with "also reacted" wording. selfId is never the
    // incoming reactor here (own devices are filtered below).
    const coReactor = !!row && !mine && !!selfId && (row.reactions ?? []).some((r) => r.userId === selfId);
    const enabled = rChat?.isGroup ? reactionCtx?.prefs?.group === true : reactionCtx?.prefs?.dm === true;
    const suppressedByChat =
      !rChat ||
      hidden.has(rChat.id) ||
      (rChat.mutedUntil !== undefined && rChat.mutedUntil > Date.now()) ||
      rChat.notifyWebPush === false ||
      (rChat.notifyContent ?? 'full') === 'none';
    if (sig.remove || (!mine && !coReactor) || from === selfId || !enabled || !showMessages || suppressedByChat) {
      return { note: null, wasMessage: false };
    }
    const showText = (rChat.notifyContent ?? 'full') === 'full' && showPreview;
    const name = known || 'Someone';
    const first = name.split(' ')[0];
    // A short quote of the reacted-to message; media/empty bodies read naturally.
    const raw = (row.body || '').replace(/\s+/g, ' ').trim();
    const quote = raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
    // Co-reactor wording says "also" and drops the "your message" claim — the
    // target is someone else's message the recipient happened to react to.
    const verb = coReactor ? `also reacted ${sig.emoji}` : `reacted ${sig.emoji}`;
    const line = rChat.isGroup
      ? quote ? `${first} ${verb} to: ${quote}` : `${first} ${verb} to ${coReactor ? 'a message you reacted to' : 'your message'}`
      : quote ? `${coReactor ? 'Also reacted' : 'Reacted'} ${sig.emoji} to: ${quote}` : `${coReactor ? 'Also reacted' : 'Reacted'} ${sig.emoji} to ${coReactor ? 'a message you reacted to' : 'your message'}`;
    return {
      note: {
        ids: [f.id as string],
        // Same masking rules as a plain message: preview off hides WHO as well.
        title: showPreview ? (rChat.isGroup ? rChat.name || 'Group' : name) : 'Ring',
        body: showText ? line : 'New message',
        url: `/chat/${rChat.id}`,
        // The chat's own tag: reactions coalesce into the ONE per-chat notification
        // (spec 2017 summary machinery included) instead of stacking (FR-003).
        tag: `ring:${rChat.id}`,
        // Tone 'none' = visible but quiet; a SW can't play the app's synthesized tones.
        silent: reactionCtx?.prefs?.tone === 'none',
      },
      wasMessage: false,
    };
  }

  // Poll votes / edits / delete-for-everyone / link-preview attach, and the session
  // re-key + disappearing-message TTL controls, are silent side effects with
  // nothing to show.
  if (
    payload.pollVote || payload.edit || payload.erase ||
    payload.linkPreviewSig || payload.rekey || payload.ttl !== undefined
  ) {
    return { note: null, wasMessage: false };
  }

  // A plain message. Honors the "Show notifications" toggle (requests above don't).
  if (!showMessages) return { note: null, wasMessage: true };

  const isGroup = !!payload.groupId;
  // Group-surface master (spec 1050): off = off for the whole surface — plain
  // messages AND the mention/reply escalation below (parity with the page path).
  if (isGroup && !showGroups) return { note: null, wasMessage: true };
  const groupChat = isGroup ? chats.find((c) => c.id === payload.groupId) : undefined;
  const senderName = known || 'Someone';
  const chat = isGroup
    ? groupChat
    : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
  // Per-chat mute: don't show an OS notification for a muted chat (the frame was
  // still fetched above, so the sender's delivery receipt is unaffected). `silenced`
  // marks this as an INTENTIONAL per-chat silence, so the caller shows no generic
  // placeholder (vs. a cold-start undecryptable frame, which still needs one) — the
  // badge still counts it.
  // Hidden chat (spec 1019, FR-007/FR-008): a content-free notification with no
  // sender, avatar, or body, and a tap that lands on the Chats tab (never the
  // hidden chat). The per-chat tag stays internal (not user-visible) so bursts
  // still coalesce. This wins over per-chat content prefs — hidden overrides them.
  if (chat && hidden.has(chat.id)) {
    return {
      note: { ids: [f.id as string], title: 'Ring', body: 'New message', url: '/tabs/chats', tag: `ring:${chat.id}` },
      wasMessage: true,
    };
  }
  // @mentions (spec 1020) + replies-to-me (spec 1048): a message that @mentions me
  // (individually, or an @everyone from the actual group OWNER) OR directly replies
  // to a message I authored (the sender snapshots the quoted author into
  // reply.senderId, so this needs no store lookup) escalates past the per-chat
  // silencers below (mute, web-push-off, content=none), and names the sender —
  // UNLESS the chat turned the "mentions even when muted" pref off (ONE dial for
  // "personally-directed pierces mute"). (Hidden chats above still win — a hidden
  // chat never escalates.) The global "Show notifications" master is honored above.
  const selfMentioned =
    isGroup &&
    (!!payload.mentions?.includes(selfId) ||
      (!!payload.mentionsEveryone && !!chat?.createdBy && from === chat.createdBy));
  const selfReplied = isGroup && !!selfId && payload.reply?.senderId === selfId;
  if ((selfMentioned || selfReplied) && chat?.notifyMentions !== false) {
    const showText = (chat?.notifyContent ?? 'full') === 'full' && showPreview;
    // An explicit @mention outranks the implicit reply variant when both apply —
    // one message, one note, the stronger wording.
    const verb = selfMentioned ? 'mentioned you' : 'replied to you';
    return {
      note: {
        ids: [f.id as string],
        title: groupChat?.name || 'Group',
        body: showText ? `${senderName} ${verb}: ${notifyPreview(payload)}` : `${senderName} ${verb}`,
        url: chat?.id ? `/chat/${chat.id}` : '/tabs/chats',
        tag: chat?.id ? `ring:${chat.id}` : `ring:from:${from}`,
      },
      wasMessage: true,
    };
  }
  if (chat?.mutedUntil && chat.mutedUntil > Date.now()) return { note: null, wasMessage: true, silenced: true };
  // Per-chat web push off (spec 1015 FR-022): suppress the system notification for
  // the closed app — the server still sent the content-free tickle (it can't know
  // per-chat prefs), so the SW enforces it here; the badge still counts the frame.
  if (chat?.notifyWebPush === false) return { note: null, wasMessage: true, silenced: true };
  // Content visibility (FR-022/FR-024). 'none' = badge-only → no notification at all.
  const content = chat?.notifyContent ?? 'full';
  if (content === 'none') return { note: null, wasMessage: true, silenced: true };
  // Show the decrypted text only when the chat allows full content AND the global
  // "Show preview" is on (most-private-wins); otherwise a content-free placeholder.
  const showText = content === 'full' && showPreview;
  const preview = showText ? notifyPreview(payload) : 'New message';
  const chatId = chat?.id;
  // "Show preview" off hides WHO it's from too, not just the body: use a generic title instead of
  // the sender / group name. (Hidden chats and @mentions are handled above and keep their own rules.)
  const title = showPreview ? (isGroup ? groupChat?.name || 'Group' : senderName) : 'Ring';
  return {
    note: {
      ids: [f.id as string],
      title,
      // Group previews prefix the sender (WhatsApp-style), but only when we know who
      // they are and full content is allowed, never the bare "Someone:" garble.
      body: isGroup && showText && known ? `${known}: ${preview}` : preview,
      url: chatId ? `/chat/${chatId}` : '/tabs/chats',
      tag: chatId ? `ring:${chatId}` : `ring:from:${from}`,
    },
    wasMessage: true,
  };
}

/** Merge notes that share a tag (same conversation / same requester) into one
 *  updating notification: the latest body, a count when more than one, and every
 *  underlying frame id so they all get marked shown. */
export function aggregate(raw: SwNote[]): SwNote[] {
  const order: string[] = [];
  const byTag = new Map<string, SwNote>();
  for (const n of raw) {
    const cur = byTag.get(n.tag);
    if (!cur) {
      byTag.set(n.tag, { ...n, ids: [...n.ids] });
      order.push(n.tag);
    } else {
      cur.ids.push(...n.ids);
      cur.body = n.body; // latest wins
      cur.title = n.title;
    }
  }
  // (spec 2017) Carry the count as a field rather than baking "(k)" into the title here. The show
  // path makes it CUMULATIVE across overlapping burst wakes (via the persisted summary) and formats
  // the title once, so the count reflects the true per-chat backlog, not this pass's unseen slice.
  return order.map((tag) => {
    const n = byTag.get(tag) as SwNote;
    return { ...n, count: n.ids.length };
  });
}

/* ---- spec 2017: per-chat "last shown" summary, for coalescing a burst into ONE notification ---- */

/** A small record of the last coalesced notification shown for a tag, so any SW wake can re-assert
 *  the ONE authoritative notification (latest body + CUMULATIVE count) instead of a stale per-pass
 *  slice or nothing. Bounded + short TTL (a burst window) so a chat read a while ago isn't
 *  resurrected with a stale count. */
export interface ShownSummary {
  tag: string;
  title: string; // base title (sender / group name), WITHOUT the "(n)" suffix
  body: string; // latest message body shown
  url: string;
  ids: string[]; // cumulative frame ids folded into this notification (count = ids.length)
  ts: number; // last update (epoch ms) — TTL'd so a stale summary doesn't re-assert forever
}
export const SUMMARY_KEY = 'swShownSummary'; // exported so the page can clear it on read (spec 2017)
const SUMMARY_TTL_MS = 2 * 60 * 1000; // a burst window; older entries don't re-assert (FR-006)
const SUMMARY_MAX = 100;

export async function loadShownSummary(): Promise<ShownSummary[]> {
  const raw = await setting<ShownSummary[]>(SUMMARY_KEY, []);
  const cutoff = Date.now() - SUMMARY_TTL_MS;
  return raw.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff && Array.isArray(e.ids));
}
async function saveShownSummary(list: ShownSummary[]): Promise<void> {
  await put<Setting<ShownSummary[]>>('settings', { key: SUMMARY_KEY, value: list.slice(-SUMMARY_MAX) });
}

/** (spec 2017) Fold a freshly-built note into the prior per-tag summary: UNION the frame ids (so the
 *  count is the cumulative per-chat backlog, not this pass's slice), take the latest body/title/url,
 *  stamp `now`. Pure → unit-tested. `prev` is the existing summary entry for this tag, if any. */
export function mergeIntoSummary(prev: ShownSummary | undefined, note: SwNote, now: number): ShownSummary {
  const ids = prev ? Array.from(new Set([...prev.ids, ...note.ids])) : [...note.ids];
  return { tag: note.tag, title: note.title, body: note.body, url: note.url, ids, ts: now };
}

/* ---- spec 2020: last-SHOWN signature per conversation, so a nothing-new wake never
 * repeats a visually identical banner. iOS renders every showNotification call as a
 * visible banner AND a separate Notification Center entry (same-tag replacement does
 * not collapse history), so the spec-2016/2017 silent re-assert reads as a duplicate
 * whenever the coalesced content hasn't changed. The signature records what the user
 * last SAW per tag (body + cumulative count); an identical re-assert is skipped —
 * the same iOS-tolerated outcome class as the mute/badge-only paths. ---- */
/* ---- spec 1034 + 2023: the no-silent-pushes policy's pure halves. iOS revokes a
 * push subscription whose service worker repeatedly consumes a wake without
 * showing a notification (the "zombie": the push service keeps accepting sends,
 * the device never wakes again — observed live on a dev iPhone). WebKit's
 * enforcement is unforgiving: webpushd counts every no-notification wake into a
 * CUMULATIVE per-subscription strike counter (three strikes for the life of the
 * subscription, no reset ever, and NO exemption for a page being on screen —
 * verified in WebKit source). Chromium is the opposite: it documents that a
 * focused page may skip the notification and never revokes. So a silent outcome
 * must be licensed TWICE — by the platform (spec 2023) and by the client state
 * (spec 1034) — and everywhere the platform is untrusted, every wake ends
 * visibly, at worst with the content-free quiet note below. ---- */

/** May this browser EVER end a push wake silently? Keyed on the browser ENGINE,
 *  not the OS: the strike counter lives in Apple's push daemon, which only
 *  WebKit-engine browsers use, while Chromium runs its own push service on every
 *  OS it ships on (including macOS) with the documented "site open and focused"
 *  exemption. iOS browser skins (CriOS/EdgiOS/FxiOS) are WebKit underneath, so
 *  they gate as unsafe despite their Chromium-ish names. Anything unrecognized is
 *  unsafe too — the costs are asymmetric: a false "unsafe" shows one extra silent
 *  notification, a false "safe" can permanently kill the subscription. */
export function platformTrustsSilence(ua: string): boolean {
  if (/\b(?:CriOS|EdgiOS|FxiOS)\//.test(ua)) return false; // iOS skins carry Chromium-ish tokens but run WebKit
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return false; // every iOS browser is WebKit → webpushd
  return /\b(?:Chrome|Chromium|HeadlessChrome|Edg)\/\d/.test(ua);
}

/** (spec 2044) iOS major version from a WebKit UA ("… CPU iPhone OS 16_7_10 like
 *  Mac OS X …" / iPad "… CPU OS 16_7 …"), or null when the UA isn't an identifiable
 *  iOS one. The iPhone|iPad|iPod token must precede the version so iPadOS-in-desktop-
 *  mode UAs (which masquerade as "Macintosh … Mac OS X 10_15_7") parse as null, never
 *  as a bogus legacy "iOS 10". */
export function iosMajorVersion(ua: string): number | null {
  const m = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+)_/.exec(ua);
  return m ? parseInt(m[1], 10) : null;
}

/** (spec 2044) The ONLY gate into the SW's lite wake path. On iOS <= 16 the
 *  service-worker context is unreliable past the network layer — IndexedDB
 *  transactions hang or throw and the decrypt/present pipeline dies silently (the
 *  iPhone 8 signature: delivered receipts fire, then no visible notification, then
 *  webpushd strikes the subscription out). Those devices get a guaranteed-visible
 *  generic-first wake instead of the rich pipeline. Fails toward MODERN: an
 *  unparseable UA must never downgrade a healthy device to generic-only. */
export const LEGACY_IOS_MAX_MAJOR = 16;
export function isLegacyIOS(ua: string): boolean {
  const major = iosMajorVersion(ua);
  return major !== null && major <= LEGACY_IOS_MAX_MAJOR;
}

/** (spec 2044) Bound a promise that may never settle — the shape of a read against a
 *  wedged SW-context IndexedDB. Falls back on timeout AND on rejection, because both
 *  must degrade the caller gracefully (a diagnostics read failing must never block
 *  the last-resort show it decorates). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/** Does any window client's state license a silent outcome? Only one that is
 *  BOTH focused AND visible: a frozen/background PWA still appears in matchAll()
 *  with cached attribute snapshots (the norm on iOS) while showing the user
 *  nothing — exactly the state that accrues strikes — and Chromium's documented
 *  exemption wording is "open and focused", not merely visible. Missing fields
 *  fail closed (an absent `focused` must never fall back to the old
 *  visibility-only license). Client state alone is HALF the license — the
 *  platform gate above is the other half (see mayEndWakeSilently). */
export function anyClientVisible(clients: readonly { visibilityState?: string; focused?: boolean }[]): boolean {
  return clients.some((c) => c.focused === true && c.visibilityState === 'visible');
}

/** The ONE license to end a push wake silently (spec 2023, amending 1034 FR-001):
 *  the platform must tolerate silence AND a Ring window must be focused+visible.
 *  On WebKit, Firefox, and unknown engines this is always false — every wake ends
 *  visibly there, no matter what the client list claims. */
export function mayEndWakeSilently(
  ua: string,
  clients: readonly { visibilityState?: string; focused?: boolean }[],
): boolean {
  return platformTrustsSilence(ua) && anyClientVisible(clients);
}

/** The content-free notification shown when the rich path has nothing it may
 *  display (muted / hidden / badge-only / nothing-new / removal-only activity):
 *  no sender, no content — the same zero-knowledge class as the push payload —
 *  and silent, so mute keeps its spirit (no buzz) while the OS still sees the
 *  visible notification the Web Push contract demands. Self-replacing tag. */
export function quietNote(kind: 'msg' | 'activity'): {
  title: string;
  options: { body: string; tag: string; silent: boolean; renotify: boolean };
} {
  return kind === 'msg'
    ? { title: 'New message', options: { body: 'You have a new message.', tag: 'ring-incoming', silent: true, renotify: false } }
    : { title: 'Ring', options: { body: 'New activity', tag: 'ring-incoming', silent: true, renotify: false } };
}

/** (spec 2023 FR-006) Wrap the platform's show call so `stamp` records it only
 *  once the platform ACCEPTS it. The guarded last-resort fallback's whole job is
 *  showing something when a wake's show FAILED — a stamp at call time records a
 *  rejected (or hung) show as shown and suppresses that fallback, inverting its
 *  "on any doubt, show" intent. The rejection still reaches the caller unchanged;
 *  only the stamp is withheld. */
export function stampedShow<A extends unknown[]>(
  raw: (...args: A) => Promise<void>,
  stamp: () => void,
): (...args: A) => Promise<void> {
  return (...args: A) => {
    const p = raw(...args);
    // Stamp on fulfillment only; the noop rejection handler keeps this DERIVED
    // promise from surfacing an unhandled rejection — the caller still observes
    // the original `p` reject.
    p.then(stamp, () => {});
    return p;
  };
}

/** (spec 2023 FR-007) Run a batch of show attempts, tolerating individual
 *  failures; the batch's visible outcome is how many the platform ACCEPTED.
 *  Callers treat 0 as "this wake has not ended visibly" and fall through to
 *  their quiet/fallback terminal instead of reporting a shown wake that never
 *  was (the pre-2023 bug: per-note catches made an all-rejected batch count as
 *  a visible ending, and the drain then acked frames nothing ever displayed). */
export async function countAccepted(shows: ReadonlyArray<() => Promise<unknown>>): Promise<number> {
  let accepted = 0;
  for (const show of shows) {
    try {
      await show();
      accepted++;
    } catch {
      /* one rejection must not kill the rest of the batch */
    }
  }
  return accepted;
}

export interface ShownSig {
  body: string;
  count: number;
  ts: number;
}
const SHOWN_SIG_KEY = 'sw.shownSig';
const SHOWN_SIG_TTL_MS = 10 * 60 * 1000;
const SHOWN_SIG_MAX = 50;

/** Pure decision (unit-tested): does this summary entry contain anything the user
 *  hasn't already seen on this tag? */
export function shouldReassert(prev: ShownSig | undefined, entry: ShownSummary): boolean {
  return !prev || prev.body !== entry.body || prev.count !== entry.ids.length;
}

export async function loadShownSigs(): Promise<Record<string, ShownSig>> {
  const raw = await setting<Record<string, ShownSig>>(SHOWN_SIG_KEY, {});
  const cutoff = Date.now() - SHOWN_SIG_TTL_MS;
  const out: Record<string, ShownSig> = {};
  for (const [tag, sig] of Object.entries(raw)) {
    if (sig && typeof sig.ts === 'number' && sig.ts >= cutoff) out[tag] = sig;
  }
  return out;
}

export async function saveShownSig(tag: string, sig: ShownSig): Promise<void> {
  const sigs = await loadShownSigs(); // already TTL-pruned
  sigs[tag] = sig;
  const entries = Object.entries(sigs)
    .sort((a, b) => a[1].ts - b[1].ts)
    .slice(-SHOWN_SIG_MAX);
  await put<Setting<Record<string, ShownSig>>>('settings', { key: SHOWN_SIG_KEY, value: Object.fromEntries(entries) });
}

/** A backgrounded, push-subscribed recipient learns of a delivery over its live socket
 *  (notify.ts) but does NOT show its own OS notification — the server also pushed it (it
 *  marks a non-foregrounded recipient inactive) and the SW owns the single notification.
 *  This seeds that note into the same shown-summary the SW's reassertFromSummary reads, so
 *  the co-arriving push wake — which finds "nothing new" once the page has acked — re-asserts
 *  THIS rich note (under its ring:<chatId> tag) instead of the content-free "New message"
 *  generic. Without it the user got the recently-backgrounded DOUBLE. The shown-sig for the
 *  tag is CLEARED (not written): the page showed no banner, so the SW's re-assert is the FIRST
 *  visible show and must not be vetoed as an identical duplicate — which it otherwise would be
 *  for back-to-back game moves that carry the same "made a move, your turn" text. */
export async function recordPageShown(
  note: { tag: string; title: string; body: string; url: string; id: string },
  now: number,
): Promise<void> {
  const list = await loadShownSummary();
  const prev = list.find((e) => e.tag === note.tag);
  const merged = mergeIntoSummary(prev, { ...note, ids: [note.id] } as SwNote, now);
  await saveShownSummary([...list.filter((e) => e.tag !== note.tag), merged]);
  const sigs = await loadShownSigs();
  if (sigs[note.tag]) {
    delete sigs[note.tag];
    await put<Setting<Record<string, ShownSig>>>('settings', { key: SHOWN_SIG_KEY, value: sigs });
  }
}

/** (spec 2017) Merge each note into the persisted summary and return the notes to actually SHOW, with
 *  `count` set to the CUMULATIVE per-chat total (so a burst shows one monotonic count, not a bouncing
 *  per-pass slice). Persists the updated summary. Serialized by the caller. */
export async function coalesceForShow(notes: SwNote[], now: number): Promise<SwNote[]> {
  if (!notes.length) return notes;
  const list = await loadShownSummary();
  const byTag = new Map(list.map((e) => [e.tag, e]));
  const out: SwNote[] = [];
  for (const n of notes) {
    const merged = mergeIntoSummary(byTag.get(n.tag), n, now);
    byTag.set(n.tag, merged);
    out.push({ ...n, count: merged.ids.length });
  }
  await saveShownSummary(Array.from(byTag.values()));
  return out;
}

/**
 * Decrypt queued frames read-only and return notification previews not yet shown.
 * Always fetches the queue first (so the server records "delivered" and we learn
 * the true backlog) even when notifications are off or the account is PIN-locked
 * (the SW can't decrypt → caller falls back to a generic notification). Never
 * persists or acks.
 */
/** Tell the server this device received a call ring push (proves it's reachable), so
 *  the caller's UI flips "Calling" -> "Ringing". Best-effort, no body. */
export async function ackCall(): Promise<void> {
  const token = await readSessionToken();
  if (!token) return;
  try {
    await fetch(`${API}/call/ack`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    /* best-effort: a missed ack just leaves the caller on "Calling" */
  }
}

/** Fetch the queued (undelivered) frames. Fetching is what tells the server the
 *  device received them (→ "delivered" receipts), so callers do it before any
 *  decryption or settings gate. Bounded so a cold-start fetch can't hang the
 *  handler. Shared by the preview path below and the authoritative drain
 *  (sw-drain.ts, spec 1032). `failure` carries the preview-path reason label. */
export async function fetchPendingFrames(token: string): Promise<{ frames: MsgFrame[] } | { failure: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/relay/pending`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.warn('[sw-inbox] /relay/pending not ok', res.status);
      return { failure: `relay-${res.status}` };
    }
    return { frames: ((await res.json()) as { frames?: MsgFrame[] }).frames ?? [] };
  } catch (e) {
    console.warn('[sw-inbox] /relay/pending fetch failed', e);
    return { failure: 'relay-error' };
  }
}

export async function previewPending(): Promise<PreviewResult> {
  const token = await readSessionToken();
  if (!token) {
    console.warn('[sw-inbox] no session token → generic');
    // Couldn't even authenticate to fetch the queue → uncertain; a real message likely woke us, so
    // honor the placeholder (newUnshown) rather than silently dropping a possible message.
    return { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: true };
  }

  // Kick the device unlock NOW, IN PARALLEL with the fetch below (spec 2010
  // root-cause c). attemptDeviceUnlock awaits libsodium's WASM init (`ready()`) then
  // unwraps the device bundle — on a cold wake (evicted SW) that init + unwrap is
  // pure CPU with no network, so overlapping it with the network round-trip hides its
  // latency inside the fetch instead of paying it serially AFTER, which used to push
  // the first decrypt past the GENERIC_AFTER_MS budget → a stranded generic. We still
  // AWAIT it before any decrypt below, so correctness is unchanged (never decrypt
  // before the key is ready).
  const unlockReady = attemptDeviceUnlock().catch(() => false);

  const fetched = await fetchPendingFrames(token);
  if ('failure' in fetched) {
    return { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: true, reason: fetched.failure };
  }
  const frames = fetched.frames;
  // No pending frames: the message was already drained (page / a prior straggler) or this push carried
  // no queued message (a settings / own-data sync wake). Nothing genuinely new → no placeholder (2016).
  if (!frames.length) return { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: false, reason: 'no-frames' };

  // Queued message frames = the undelivered backlog → the app-icon badge. Known
  // from the fetch alone, so the badge is right even if we can't decrypt.
  //
  // Spec 1032 (security review F8): frames the authoritative drain already
  // COMMITTED can linger here (their ack failed, or a redelivery raced the ack) —
  // they are already inside the stored unread count, so counting them as pending
  // would double-badge, and re-decrypting them would fail (their message keys are
  // consumed) and masquerade as a decrypt failure. Treat committed frames as
  // neither pending nor previewable; they resolve to a bare re-ack on the next
  // drain or page open.
  const committed = new Set(await setting<string[]>('inboundSeenIds', []));
  const pending = frames.filter((f) => f.t === 'msg' && !!f.id && !committed.has(f.id)).length;
  console.info('[sw-inbox] fetched frames', { total: frames.length, pending });

  // Badge mode (spec 1027, B4): under 'never'/'revealed' only frames we can
  // POSITIVELY attribute to a non-hidden chat may bump the badge.
  const badgeMode = await setting<string>('privacy.hiddenChatsBadge', 'always');
  const badgeAll = badgeMode === 'always';

  const showMessages = await setting<boolean>('notifications.message.show', true);
  const showGroups = await setting<boolean>('notifications.group.show', true);

  // Now decrypt for the rich preview. PIN/passkey-locked (no device key) → generic
  // (the frames were still fetched above, so the sender already got "delivered").
  // Awaits the unlock kicked off in parallel above (its init overlapped the fetch),
  // so a stalled libsodium init never blocks delivery and a cold start doesn't pay
  // unlock latency serially after the fetch.
  if (!(await unlockReady)) {
    console.warn('[sw-inbox] device unlock failed (PIN-locked?) → generic');
    // Can't tell a message from a request → let the caller show a generic, UNLESS
    // the user disabled message notifications (then stay silent rather than buzz).
    // Locked but there ARE pending msg frames we couldn't decrypt → a genuinely-new message warrants
    // the placeholder (newUnshown). If only non-msg frames are queued (pending === 0) there's nothing
    // new to announce here.
    // Locked → nothing is classifiable, so a non-'always' badge adds nothing
    // here (unreadCount's badge.lastCount fallback still covers the stored part).
    return { notes: [], pending, badgePending: badgeAll ? pending : 0, suppressed: !showMessages, silenced: false, newUnshown: pending > 0, reason: 'locked' };
  }

  const showPreview = await setting<boolean>('notifications.showPreview', true);
  const [chats, contacts, shown, hidden, selfId] = await Promise.all([
    getAll<Chat>('chats'),
    getAll<Contact>('contacts'),
    loadShown(),
    readHiddenSet(), // spec 1019: hidden chats get a generic, content-free notification
    readSessionUserId(), // spec 1020: needed to detect "am I @mentioned?" in the SW
  ]);
  const seen = new Set(shown);

  const raw: SwNote[] = [];
  const callEvents: CallEventSignal[] = []; // spec 1040: markers for sw.ts's badge/close effects
  let callEventFrames = 0; // markers are side effects, not backlog — keep them out of the badge count
  let badgeable = 0; // frames provably in a NON-hidden chat (badge modes never/revealed)
  let withheldMessage = false;
  let silencedMessage = false; // a message intentionally silenced by per-chat prefs
  let decryptFailed = 0; // frames we couldn't decrypt (cold start / session not reachable)
  for (const f of frames) {
    if (f.t !== 'msg' || !f.from || !f.id || seen.has(f.id) || committed.has(f.id)) continue;
    let payload: MessagePayload;
    try {
      payload = await previewPacket(sessionKeyForPeer(chats, f.from), f.ciphertext);
    } catch (e) {
      console.warn('[sw-inbox] decrypt failed for a frame → skipped', e);
      decryptFailed += 1;
      continue; // can't decrypt this one (session not reachable yet) → leave it for the page
    }
    seen.add(f.id);
    if (payload.callEvent) {
      callEvents.push(payload.callEvent);
      callEventFrames += 1;
    }
    // Classify for the badge (spec 1027): the frame counts only when its chat
    // resolves AND is provably not hidden. Same resolution noteForPayload uses.
    if (!badgeAll) {
      const bChat = payload.groupId
        ? chats.find((c) => c.id === payload.groupId)
        : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === f.from);
      if (bChat && !hidden.has(bChat.id)) badgeable += 1;
    }
    // Game context (spec 0008 T041 / spec 0009 US2): the target bubble's stored
    // row (winner naming + group seats), the game-notification prefs, and the
    // device-local follow set. Absent row → the generic named-mover fallback.
    const gameTargetId = payload.gameMove?.messageId ?? payload.gameAccept?.messageId;
    const gameCtx = gameTargetId
      ? {
          row: await get<Message>('messages', gameTargetId),
          prefs: {
            turn: await setting<boolean>('notifications.games.turn', true),
            challenges: await setting<boolean>('notifications.games.challenges', true),
            followMoves: await setting<boolean>('notifications.games.followMoves', true),
            followResults: await setting<boolean>('notifications.games.followResults', true),
          },
          follows: await setting<Record<string, number>>('games.follows', {}),
        }
      : undefined;
    // Reaction context (spec 1048): the reacted-to message's stored row (tells
    // "is it MINE?" + provides the quote) and the gates/tone. The row read is the
    // same read-only pattern as the game context above; an unresolvable target
    // (deleted, or the reaction outran its message) keeps the reaction silent.
    const reactionCtx = payload.reaction
      ? {
          row: await get<Message>('messages', payload.reaction.messageId),
          prefs: {
            dm: await setting<boolean>('notifications.message.reactions', true),
            group: await setting<boolean>('notifications.group.reactions', true),
            tone: await setting<string>('notifications.reactions.sound', 'pop'),
          },
        }
      : undefined;
    const { note, wasMessage, silenced } = noteForPayload(f, payload, chats, contacts, showMessages, showPreview, hidden, selfId ?? '', gameCtx, reactionCtx, { showGroups });
    if (note) raw.push(note);
    else if (silenced) silencedMessage = true;
    else if (wasMessage && !showMessages) withheldMessage = true;
  }

  const notes = aggregate(raw);
  console.info('[sw-inbox] built notes', notes.length, 'of pending', pending);
  // Deliberately DON'T persist `seen` here; the caller marks notes shown only after
  // actually displaying them (markShown), so a discarded/timed-out preview can't
  // suppress a later rich notification for the same message.
  //
  // suppressed = we'd have alerted but "Show notifications" is off and nothing else
  // (a request/invite) needs surfacing → caller skips the generic placeholder.
  const suppressed = notes.length === 0 && (withheldMessage || !showMessages);
  // silenced = nothing to show AND everything we could decrypt was intentionally
  // per-chat silenced (mute / web-push-off / badge-only), with no undecryptable
  // frames left that might warrant a placeholder. Caller shows NO notification but
  // STILL badges the pending count (spec 1015 FR-022/FR-024). If a frame couldn't be
  // decrypted (decryptFailed > 0) we can't know its chat, so we fall back to the
  // generic placeholder (userVisibleOnly) rather than silently dropping it.
  const silenced = notes.length === 0 && !suppressed && silencedMessage && decryptFailed === 0;
  // (spec 2014 US2) If we'll fall back to the generic (no notes, not suppressed/silenced) because
  // frames were fetched but none decrypted, tag it so the dev deployment can show why.
  const reason = notes.length === 0 && !suppressed && !silenced && decryptFailed > 0 ? 'decrypt-failed' : undefined;
  // (spec 2016) A genuinely-new message we couldn't render = an UNSEEN frame that failed to decrypt.
  // When every fetched frame was already shown (all-seen), decryptFailed === 0 and notes is empty →
  // newUnshown is false → the caller shows NO new placeholder (kills the burst extra-generic).
  const newUnshown = decryptFailed > 0;
  // Spec 1040: call-event markers are side effects, never unread backlog — a call
  // would otherwise inflate the badge by its two markers on top of its own unit.
  const backlog = Math.max(0, pending - callEventFrames);
  return {
    notes,
    pending: backlog,
    badgePending: badgeAll ? backlog : badgeable,
    suppressed,
    silenced,
    newUnshown,
    reason,
    ...(callEvents.length ? { callEvents } : {}),
  };
}

/* ---- call-event support for the SW (spec 1040) ---- */

/** What the {"t":"call"} wake shows once a fresh ring marker decrypts. */
export type CallRingPreview =
  | { kind: 'named'; title: string; body: string; callId: string }
  | { kind: 'generic'; callId?: string } // marker found but identity must not show (hidden chat) or resolves to nothing
  | null; // nothing usable — stay on today's generic ring

/**
 * Bounded, read-only scan of the pending queue for the freshest still-ringing
 * call marker — the call wake names its notification from this. Never touches
 * the shown ledger and never acks, so reminder wakes re-run it and upgrade the
 * same notification in place (research R2). PIN-locked or undecryptable → null
 * (the generic ring already showed; FR-004 keeps the first alert undelayed).
 */
export async function previewCallRing(): Promise<CallRingPreview> {
  const token = await readSessionToken();
  if (!token) return null;
  const unlockReady = attemptDeviceUnlock().catch(() => false);
  const fetched = await fetchPendingFrames(token);
  if ('failure' in fetched || !fetched.frames.length) return null;
  if (!(await unlockReady)) return null;
  const [chats, contacts, hidden, committedIds] = await Promise.all([
    getAll<Chat>('chats'),
    getAll<Contact>('contacts'),
    readHiddenSet(),
    setting<string[]>('inboundSeenIds', []),
  ]);
  const committed = new Set(committedIds);
  let best: { ev: CallEventSignal; from: string } | null = null;
  const endedIds = new Set<string>();
  for (const f of fetched.frames) {
    if (f.t !== 'msg' || !f.from || !f.id || committed.has(f.id)) continue;
    let payload: MessagePayload;
    try {
      payload = await previewPacket(sessionKeyForPeer(chats, f.from as string), f.ciphertext);
    } catch {
      continue;
    }
    const ev = payload.callEvent;
    if (!ev) continue;
    if (ev.phase === 'ended') {
      endedIds.add(ev.callId);
      continue;
    }
    // `at` is the sender's clock — a display-freshness hint only. A stale ring
    // stays generic rather than naming a caller who is no longer calling.
    if (Date.now() - ev.at > RING_WINDOW_MS) continue;
    if (!best || ev.at > best.ev.at) best = { ev, from: f.from as string };
  }
  if (!best || endedIds.has(best.ev.callId)) return null;
  const { ev, from } = best;
  const chat = ev.roomId
    ? chats.find((c) => c.id === ev.roomId && c.isGroup)
    : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
  // Hidden chat → the ring must stay generic AND its badge unit is withdrawn by
  // the caller (hidden calls never badge).
  if (chat && hidden.has(chat.id)) return { kind: 'generic', callId: ev.callId };
  const caller = contacts.find((c) => c.id === from)?.name;
  if (!caller && !(ev.roomId && chat)) return { kind: 'generic', callId: ev.callId }; // never a raw id (FR-006)
  const emoji = ev.kind === 'video' ? '📹' : '📞';
  if (ev.roomId && chat) {
    return { kind: 'named', title: chat.name, body: `${caller || 'Someone'} is calling ${emoji}`, callId: ev.callId };
  }
  return { kind: 'named', title: caller as string, body: `is calling you ${emoji}`, callId: ev.callId };
}

/** What the 'ring-call' notification currently says (spec 2026): the ring flow
 *  reads this to avoid re-shows that would stack Notification Center entries on
 *  iOS (reminder downgrades to generic, repeat namings). TTL'd by the ring
 *  window via the pure helpers in call-events.ts. */
const RING_SHOWN_KEY = 'sw.ringShown';

export async function readRingShown(): Promise<RingShownSig | undefined> {
  return setting<RingShownSig | undefined>(RING_SHOWN_KEY, undefined);
}

export async function recordRingShown(sig: RingShownSig): Promise<void> {
  await put<Setting<RingShownSig>>('settings', { key: RING_SHOWN_KEY, value: sig });
}

/** The ring is over (outcome arrived / page took over): a later tickle must not
 *  re-assert the stale name. */
export async function clearRingShown(): Promise<void> {
  await recordRingShown({ named: false, ts: 0 });
}

/** The transient per-call badge units (spec 1040), shared with the page through
 *  the settings store; the page clears them wholesale on foreground (FR-009). */
const CALL_BADGE_KEY = 'sw.callBadge';

export async function callBadgeCount(): Promise<number> {
  const units = await setting<CallBadgeUnit[]>(CALL_BADGE_KEY, []);
  return sweepStaleUnits(units, Date.now()).length;
}

/** A call tickle arrived: ensure exactly one ringing unit for it (callId when a
 *  marker already resolved, else the ring-window heuristic — see call-events.ts). */
export async function recordCallTickle(callId?: string): Promise<void> {
  const units = sweepStaleUnits(await setting<CallBadgeUnit[]>(CALL_BADGE_KEY, []), Date.now());
  await put<Setting<CallBadgeUnit[]>>('settings', { key: CALL_BADGE_KEY, value: applyCallTickle(units, callId, Date.now()) });
}

/** An outcome marker decrypted: hand the unit over (missed) or retire it (answered). */
export async function recordCallOutcome(callId: string | undefined, outcome: 'missed' | 'cancelled' | 'answered'): Promise<void> {
  const units = sweepStaleUnits(await setting<CallBadgeUnit[]>(CALL_BADGE_KEY, []), Date.now());
  await put<Setting<CallBadgeUnit[]>>('settings', { key: CALL_BADGE_KEY, value: applyCallOutcome(units, callId, outcome, Date.now()) });
}

/** Withdraw one unit entirely (a hidden chat's call must never badge). */
export async function withdrawCallBadgeUnit(callId: string | undefined): Promise<void> {
  await recordCallOutcome(callId, 'answered');
}

/**
 * (spec 2016) Should this preview result NOT produce a new generic placeholder because there's nothing
 * genuinely new to announce? True when we have no notes to show, the user didn't disable/silence
 * notifications, AND there's no genuinely-new unrendered message — i.e. the relay queue was empty
 * (`no-frames`) or every fetched frame was already shown. The caller honors the per-push contract for
 * these by re-asserting an existing notification silently (or showing nothing), never a new "New
 * message" banner. A slow cold-start that times out before the preview settles is handled separately
 * by the caller (it shows the placeholder immediately, then upgrades/closes it on settle).
 */
export function isNothingNew(r: PreviewResult): boolean {
  return r.notes.length === 0 && !r.suppressed && !r.silenced && !r.newUnshown;
}

/** Persist the frame ids we actually displayed, so they aren't re-shown on the next
 *  push (the SW never acks, so frames linger in the relay queue until the page
 *  drains). Merges into the bounded `swNotifiedIds` ledger. */
export async function markShown(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = Date.now();
  const entries = await loadShownEntries(); // already pruned of expired
  const known = new Set(entries.map((e) => e.id));
  for (const id of ids) if (!known.has(id)) entries.push({ id, ts: now });
  await put<Setting<ShownEntry[]>>('settings', { key: SHOWN_KEY, value: entries.slice(-SHOWN_MAX) });
}

/** Best-effort unread total from the on-device chats. The SW can't persist the new
 *  message (read-only preview), so the push handler adds the count of fresh
 *  notifications on top for the app-icon badge.
 *
 *  Honors `privacy.hiddenChatsBadge` (spec 1027, B4): 'never' excludes hidden
 *  chats; 'revealed' behaves as 'never' here because the reveal session is
 *  page-memory-only and the SW must never assume it. When the hidden set can't
 *  be decrypted (locked), fall back to `badge.lastCount` — the page's last
 *  successfully computed, already preference-filtered total — rather than
 *  guessing in either direction. */
export async function unreadCount(): Promise<number> {
  const chats = await getAll<Chat>('chats');
  const mode = await setting<string>('privacy.hiddenChatsBadge', 'always');
  if (mode === 'always') return chats.reduce((n, c) => n + (c.unread || 0), 0);
  const hidden = await readHiddenSetOrNull();
  if (!hidden) return (await setting<number | null>('badge.lastCount', null)) ?? 0;
  return chats.reduce((n, c) => n + (hidden.has(c.id) ? 0 : c.unread || 0), 0);
}

/* ---- friend-request (connection) lifecycle notifications (spec 1015 US2) ---- */

// The conn tickle is content-free, so on wake the SW reconciles the authoritative
// state from GET /v1/connections (just user ids + state — no decryption needed, so
// this works even while PIN-locked) and shows a GENERIC, identity-safe notice
// (FR-012a: never a name/raw id for a not-yet-a-contact requester). A ledger keyed
// by (kind,peer) makes repeated/duplicate conn tickles idempotent (no re-notify for
// an unchanged event), and expires by age so an old entry can't suppress forever.
const CONN_SHOWN_KEY = 'swConnShownKeys';
const CONN_SHOWN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CONN_SHOWN_MAX = 500;

/** A ready-to-show friend-request notification. `keys` are the dedup-ledger keys it
 *  covers; the caller marks them shown after displaying so they don't re-notify. */
export interface ConnNote {
  keys: string[];
  title: string;
  body: string;
  url: string;
  tag: string;
}

async function loadConnShownEntries(): Promise<ShownEntry[]> {
  const raw = await setting<ShownEntry[]>(CONN_SHOWN_KEY, []);
  const cutoff = Date.now() - CONN_SHOWN_TTL_MS;
  return raw.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff);
}

interface ConnReq {
  requester?: string;
  target?: string;
  state?: string;
}

/**
 * Build generic friend-request notifications for the conn tickle. Reconciles the
 * server's connection state against a dedup ledger so only NEW events surface:
 *   - an incoming pending request  → "New friend request"
 *   - our outgoing request accepted → "Your friend request was accepted"
 *   - our outgoing request rejected → "Your friend request was declined"
 * All bodies are identity-safe (no names / ids), so nothing about who is exposed,
 * and no decryption is needed. Returns [] on any auth/network failure.
 */
/** A requester's/target's name for a friend-request notification: their public
 *  directory profile (display name, else @username). Fetched LOCALLY by the SW — the
 *  identity never rides in the content-free push. 'Someone' if it can't be resolved. */
async function connName(userId: string, token: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const u = (await res.json()) as { displayName?: string; username?: string };
      return u.displayName?.trim() || (u.username ? `@${u.username}` : 'Someone');
    }
  } catch {
    /* fall through to a generic, identity-safe label */
  }
  return 'Someone';
}

/** One announceable friend-request lifecycle event (pure classification). */
export interface ConnEvent {
  key: string; // dedup-ledger key
  userId: string; // whose name the note carries (resolved by the IO wrapper)
  body: string;
  tag: string;
}

/**
 * Classify the server's connection state into NEW events (pure core, unit-
 * tested; spec 1040 US3). Incoming pending → "wants to be friends"; OUR
 * outgoing accepted/rejected → the truthful outcome copy. The dedup ledger
 * (`seen`) keeps each event announced at most once (FR-022) — the server's
 * 24h accepted-row window sits inside the ledger's 48h TTL, so an accepted
 * row can never re-announce after its ledger entry expires.
 */
export function classifyConnEvents(
  data: { incoming?: ConnReq[]; outgoing?: ConnReq[] },
  seen: ReadonlySet<string>,
): { events: ConnEvent[]; pendingIncoming: number } {
  const events: ConnEvent[] = [];
  const taken = new Set(seen);
  const add = (key: string, userId: string, body: string, tag: string): void => {
    if (taken.has(key)) return;
    taken.add(key);
    events.push({ key, userId, body, tag });
  };
  let pendingIncoming = 0;
  for (const r of data.incoming ?? []) {
    if (r.state === 'pending' && r.requester) {
      pendingIncoming++;
      add(`req:${r.requester}`, r.requester, 'wants to be friends', 'ring:conn:req');
    }
  }
  for (const r of data.outgoing ?? []) {
    if (!r.target) continue;
    if (r.state === 'accepted') add(`acc:${r.target}`, r.target, 'accepted your friend request', `ring:conn:acc:${r.target}`);
    else if (r.state === 'rejected') add(`rej:${r.target}`, r.target, 'declined your friend request', `ring:conn:rej:${r.target}`);
  }
  return { events, pendingIncoming };
}

export async function previewConnections(): Promise<{ notes: ConnNote[]; pendingIncoming: number }> {
  const token = await readSessionToken();
  if (!token) return { notes: [], pendingIncoming: 0 };
  let data: { incoming?: ConnReq[]; outgoing?: ConnReq[] };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      // ?include=accepted (spec 1040): the DEFAULT list means unresolved
      // requests (the UI's contract — an answered request leaves it); only this
      // reconcile also wants the recently-accepted rows its "accepted your
      // friend request" note is built from.
      res = await fetch(`${API}/connections?include=accepted`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { notes: [], pendingIncoming: 0 };
    data = (await res.json()) as { incoming?: ConnReq[]; outgoing?: ConnReq[] };
  } catch {
    return { notes: [], pendingIncoming: 0 };
  }
  const seen = new Set((await loadConnShownEntries()).map((e) => e.id));
  // Title = WHO, body = the action — so iOS renders "<name>: wants to be friends". The app
  // name ("Ring") is already the notification's source line, so the old "Ring / New friend
  // request" was doubly redundant.
  const { events, pendingIncoming } = classifyConnEvents(data, seen);
  const notes: ConnNote[] = [];
  for (const ev of events) {
    notes.push({ keys: [ev.key], title: await connName(ev.userId, token), body: ev.body, url: '/tabs/contacts', tag: ev.tag });
  }
  return { notes, pendingIncoming };
}

// Wall: on a "new post" tickle (app closed), name the author instead of a generic placeholder.
// The author is server-visible metadata (not E2EE content), so this needs NO decryption — we
// resolve their public directory name, exactly like a friend request. Recent-window + a cursor
// keep us from re-announcing old posts; collapsed by author so 3 posts from X = one "X posted".
const POST_SINCE_KEY = 'sw.postNotifySince';
const POST_RECENT_MS = 10 * 60 * 1000;
export async function previewPosts(): Promise<{ notes: ConnNote[]; newCount: number }> {
  const token = await readSessionToken();
  if (!token) return { notes: [], newCount: 0 };
  const self = await readSessionUserId();
  const since = (await setting<number>(POST_SINCE_KEY, 0)) || 0;
  let data: {
    posts?: Array<{ id: string; author: string; createdAt: number; blobId?: string; size?: number; wrappedKey?: string }>;
    cursor?: number;
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/posts?since=${since}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { notes: [], newCount: 0 };
    data = (await res.json()) as typeof data;
  } catch {
    return { notes: [], newCount: 0 };
  }
  const cutoff = Date.now() - POST_RECENT_MS;
  const fresh = (data.posts ?? []).filter((p) => p.author && p.author !== self && (p.createdAt ?? 0) > cutoff);
  const notes: ConnNote[] = [];
  const seen = new Set<string>();
  for (const p of fresh) {
    if (seen.has(p.author)) continue;
    seen.add(p.author);
    notes.push({
      keys: [`post:${p.id}`],
      title: await connName(p.author, token),
      // A game-challenge post earns the urgent line (spec 0009): unseal the
      // post right here in the SW when the keystore allows. Anything else —
      // PIN-locked, offline blob, media post, tampered — keeps the generic
      // content-free line, exactly what all posts said before.
      body: (await swPostChallengeLine(p, token)) ?? 'posted on their Wall',
      url: '/tabs/wall',
      tag: `ring:post:${p.author}`,
    });
  }
  if (data.cursor && data.cursor > since) {
    await put<Setting<number>>('settings', { key: POST_SINCE_KEY, value: data.cursor });
  }
  return { notes, newCount: fresh.length };
}

// A challenge post is text-only and tiny; never pull a media post's blob just
// for notification copy.
const CHALLENGE_POST_MAX_BYTES = 16_384;

/** If this fresh post is a game CHALLENGE, return the urgent line for its push
 *  note; null for everything else (generic line) — including every failure
 *  (locked keystore, blob fetch, tampered seal): silence about content beats a
 *  wrong claim. Decryption happens on-device, same trust as the page. */
async function swPostChallengeLine(
  p: { id: string; blobId?: string; size?: number; wrappedKey?: string },
  token: string,
): Promise<string | null> {
  try {
    if (!p.wrappedKey || !p.blobId || (p.size ?? Infinity) > CHALLENGE_POST_MAX_BYTES) return null;
    await sodiumReady();
    if (!(await attemptDeviceUnlock())) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/blobs/${encodeURIComponent(p.blobId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { payload } = openReceivedPost(bytes, p.wrappedKey, getIdentityKeys().x.privateKey);
    if (!payload.game) return null;
    const gname = GAMES[payload.game.gameType]?.displayName ?? 'game';
    return `started a ${gname} challenge, be quick if you want it 🎮`;
  } catch {
    return null;
  }
}

/* ---- owner-only Wall engagement notifications (spec 1031) ---- */

// A `post-activity` push means someone engaged with OUR post. The payload carries the
// post id (sealed inside the encrypted push envelope), so the SW pulls exactly that
// post's engagement. Actor + kind are server metadata (no decryption needed for a
// comment note); the reaction add-vs-remove flag is sealed under K_post, so it is
// opened LOCALLY with the key on our own post row — an unopenable reaction is skipped
// (never a spurious alert for what might be a removal). A ledger keyed by engagement
// id keeps repeated tickles idempotent, mirroring the conn ledger.
const WALL_ACT_SHOWN_KEY = 'sw.wallActShown';
const WALL_ACT_SHOWN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const WALL_ACT_SHOWN_MAX = 500;
const WALL_ACT_RECENT_MS = 10 * 60 * 1000;

export interface PostActivityRow {
  id: string;
  actor: string;
  kind: string;
  payload: string;
  createdAt: number;
}

export interface PostActivityItem {
  id: string;
  actor: string;
  kind: 'reaction' | 'comment';
}

/**
 * The pure filter behind previewPostActivity: which engagement rows deserve a note?
 * Owner-only is re-checked HERE (the post row must be ours — defense in depth against
 * a misrouted push), self/stale/already-shown rows drop, and a reaction survives only
 * when `openReaction` proves it is an ADD. `openReaction` may throw (locked device /
 * cold start) — that reaction is skipped silently while comments still pass.
 */
export function classifyPostActivity(args: {
  post: { outgoing?: boolean; postKey?: string } | null | undefined;
  self: string;
  rows: PostActivityRow[];
  seen: Set<string>;
  now: number;
  openReaction: (postKeyB64: string, payload: string) => { remove?: boolean };
}): PostActivityItem[] {
  const { post, self, rows, seen, now, openReaction } = args;
  if (!post?.outgoing) return []; // not ours (or pruned/expired) → never alert
  const cutoff = now - WALL_ACT_RECENT_MS;
  const items: PostActivityItem[] = [];
  for (const r of rows) {
    if (!r.actor || r.actor === self) continue; // self-actions never alert
    if (seen.has(r.id)) continue; // already announced on an earlier wake
    if ((r.createdAt ?? 0) <= cutoff) continue; // stale backlog must not flood
    if (r.kind === 'comment') {
      items.push({ id: r.id, actor: r.actor, kind: 'comment' });
    } else if (r.kind === 'reaction') {
      if (!post.postKey) continue; // no key → can't prove add-vs-remove → stay silent
      try {
        if (openReaction(post.postKey, r.payload).remove) continue; // removals never alert
      } catch {
        continue; // unopenable (locked/cold) → silence beats a possibly-wrong alert
      }
      items.push({ id: r.id, actor: r.actor, kind: 'reaction' });
    }
    // tombstones / views / unknown kinds never alert (spec 1031 FR-011)
  }
  return items;
}

/**
 * Wall games on push wake (spec 0009 US3): the audience-wide 'post-activity'
 * push fans to every device that can see a challenge post; THIS pure classifier
 * replays the fetched game rows through the same engine every page uses and
 * decides, from my seat + my private follow + my prefs, whether to say anything.
 * Returns null when nothing is fresh; otherwise the fresh ledger keys plus a
 * note (or `note: null` for a deliberate quiet — keys still get ledgered so a
 * repeated tickle stays silent too).
 */
export function classifyWallGameActivity(args: {
  post:
    | { author?: string; outgoing?: boolean; postKey?: string; game?: { gameType: string; theme?: string } }
    | null
    | undefined;
  self: string;
  rows: PostActivityRow[];
  seen: Set<string>;
  prefs: { turn: boolean; challenges: boolean; followMoves: boolean; followResults: boolean };
  followed: boolean;
  openGame: (postKeyB64: string, payload: string) => WallGameRow['payload'];
  names: Map<string, string>;
}): { keys: string[]; note: { title: string; body: string } | null } | null {
  const { post, self, rows, seen, prefs, followed, openGame, names } = args;
  if (!post?.game || !post.postKey || !post.author) return null;
  const gameRows: WallGameRow[] = [];
  const fresh: { id: string; actor: string; at: number }[] = [];
  for (const r of rows) {
    if (r.kind !== 'game') continue;
    let payload: WallGameRow['payload'];
    try {
      payload = openGame(post.postKey, r.payload);
    } catch {
      continue; // unopenable (locked/cold) → treat as absent
    }
    gameRows.push({ id: r.id, actor: r.actor, payload });
    if (!seen.has(r.id) && r.actor && r.actor !== self) fresh.push({ id: r.id, actor: r.actor, at: payload.at });
  }
  if (!fresh.length) return null;
  const session = buildWallSession(GAMES[post.game.gameType] ?? null, post.author, post.game, gameRows);
  const status = deriveGameStatus(GAMES[session.gameType] ?? null, session);
  const me = playerIndexOf(session, self);
  const latest = fresh.sort((x, y) => x.at - y.at)[fresh.length - 1];
  const mover = names.get(latest.actor) ?? 'Someone';
  const keys = fresh.map((f) => f.id);
  const quiet = { keys, note: null };

  // The note's TITLE is the mover, so the body is NAME-FREE (leading with the
  // name here would repeat it — "iPad iPad made a move").
  let body: string | null = null;
  if (me !== null) {
    if (challengePhase(session) === 'accepted' && session.moves.length === 0 && me === 0) {
      if (!prefs.challenges) return quiet;
      body = 'accepted your challenge 💪 Your move!';
    } else if (status.state === 'ongoing') {
      if (status.turn !== me) return quiet; // my own side already knows; their move next
      if (!prefs.turn) return quiet;
      body = 'made a move, your turn 😏';
    } else if (status.state === 'won') {
      body = 'won the game 🏆';
    } else if (status.state === 'resigned') {
      body = session.players?.[status.winner] === self ? 'gave up. You win! 🏆' : 'gave up 🏳️';
    } else if (status.state === 'draw') {
      body = "It's a draw 🤝";
    }
  } else if (followed) {
    if (status.state === 'ongoing') {
      if (!prefs.followMoves) return quiet;
      body = 'made a move 🎲';
    } else if (status.state === 'won') {
      if (!prefs.followResults) return quiet;
      body = 'won the game 🏆';
    } else if (status.state === 'resigned') {
      if (!prefs.followResults) return quiet;
      body = 'gave up 🏳️';
    } else if (status.state === 'draw') {
      if (!prefs.followResults) return quiet;
      body = "It's a draw 🤝";
    }
  } else {
    // (spec 1036, reverting 1035) A spectator who never followed stays quiet —
    // mid-game AND at the result. Following is the opt-in; followers are woken
    // by the 'gameover' push and land in the followed branch above.
    return quiet;
  }
  if (!body) return quiet;
  return { keys, note: { title: mover, body } };
}

/** Render the surviving items as notification note(s): one item → an actor-named
 *  note; several → ONE collapsed note (per-post tag) covering all their ledger keys. */
export function buildPostActivityNotes(
  postId: string,
  items: PostActivityItem[],
  names: Map<string, string>,
): ConnNote[] {
  if (!items.length) return [];
  const url = `/wall/post/${postId}`;
  const tag = `ring:post:act:${postId}`;
  if (items.length === 1) {
    const it = items[0];
    return [{
      keys: [it.id],
      title: names.get(it.actor) ?? 'Someone',
      body: it.kind === 'comment' ? 'commented on your post' : 'reacted to your post',
      url,
      tag,
    }];
  }
  return [{ keys: items.map((i) => i.id), title: 'Ring', body: 'New activity on your post', url, tag }];
}

async function loadWallActShownEntries(): Promise<ShownEntry[]> {
  const raw = await setting<ShownEntry[]>(WALL_ACT_SHOWN_KEY, []);
  const cutoff = Date.now() - WALL_ACT_SHOWN_TTL_MS;
  return raw.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff);
}

/**
 * Build the closed-app notification(s) for engagement on one of OUR posts. Fetches
 * that post's engagement list, filters via classifyPostActivity (owner re-check,
 * ledger, recency, removal-proofing), resolves actor names from the public directory
 * (like previewPosts), and persists the ledger for what will be displayed. Returns []
 * on any failure — a wrong silence self-heals on next open; a wrong alert doesn't.
 */
export async function previewPostActivity(postId: string): Promise<ConnNote[]> {
  if (!postId) return [];
  const token = await readSessionToken();
  if (!token) return [];
  const self = (await readSessionUserId()) ?? '';
  const post = await get<{
    id: string;
    author?: string;
    outgoing?: boolean;
    postKey?: string;
    game?: { gameType: string; theme?: string };
  }>('posts', postId);
  let rows: PostActivityRow[] = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/posts/${encodeURIComponent(postId)}/engagement`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    rows = ((await res.json()) as { items?: PostActivityRow[] }).items ?? [];
  } catch {
    return [];
  }
  // libsodium must be initialized before opening sealed reaction payloads; comments
  // never need it, so a failed init only silences reactions (classify's catch).
  await sodiumReady().catch(() => {});
  const seen = new Set((await loadWallActShownEntries()).map((e) => e.id));
  const items = classifyPostActivity({ post, self, rows, seen, now: Date.now(), openReaction: openPostEngagement });

  // A game-challenge post (spec 0009): the audience-wide push means WE may be a
  // player or follower — replay the game rows and decide locally.
  let gameKeys: string[] = [];
  let gameNote: ConnNote | null = null;
  if (post?.game) {
    const prefs = {
      turn: await setting<boolean>('notifications.games.turn', true),
      challenges: await setting<boolean>('notifications.games.challenges', true),
      followMoves: await setting<boolean>('notifications.games.followMoves', true),
      followResults: await setting<boolean>('notifications.games.followResults', true),
    };
    const follows = await setting<Record<string, number>>('games.follows', {});
    const gnames = new Map<string, string>();
    for (const actor of new Set(rows.filter((r) => r.kind === 'game').map((r) => r.actor))) {
      gnames.set(actor, await connName(actor, token));
    }
    const g = classifyWallGameActivity({
      post, self, rows, seen, prefs,
      followed: follows[postId] !== undefined,
      openGame: openPostEngagement,
      names: gnames,
    });
    if (g) {
      gameKeys = g.keys;
      if (g.note) {
        gameNote = { keys: g.keys, title: g.note.title, body: g.note.body, url: `/wall/post/${postId}`, tag: `ring:post:game:${postId}` };
      }
    }
  }
  if (!items.length && !gameKeys.length) return [];
  const names = new Map<string, string>();
  for (const actor of new Set(items.map((i) => i.actor))) {
    names.set(actor, await connName(actor, token));
  }
  // Persist the ledger for what we're about to display so a repeated tickle
  // (collapse topic re-fire, multi-device) doesn't re-announce the same items.
  // Game keys ledger even when deliberately quiet.
  const entries = await loadWallActShownEntries();
  const known = new Set(entries.map((e) => e.id));
  const ts = Date.now();
  for (const it of items) if (!known.has(it.id)) entries.push({ id: it.id, ts });
  for (const k of gameKeys) if (!known.has(k)) entries.push({ id: k, ts });
  await put<Setting<ShownEntry[]>>('settings', { key: WALL_ACT_SHOWN_KEY, value: entries.slice(-WALL_ACT_SHOWN_MAX) });
  return [...buildPostActivityNotes(postId, items, names), ...(gameNote ? [gameNote] : [])];
}

/** Persist the conn-ledger keys we displayed, so the same event doesn't re-notify
 *  on the next conn tickle (idempotency / no duplicate outcome notifications). */
export async function markConnShown(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const now = Date.now();
  const entries = await loadConnShownEntries();
  const known = new Set(entries.map((e) => e.id));
  for (const k of keys) if (!known.has(k)) entries.push({ id: k, ts: now });
  await put<Setting<ShownEntry[]>>('settings', { key: CONN_SHOWN_KEY, value: entries.slice(-CONN_SHOWN_MAX) });
}
