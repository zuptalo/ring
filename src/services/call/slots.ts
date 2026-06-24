/**
 * Pure call-slot reducer (spec 0005 — call waiting). A user holds at most TWO calls: one
 * `active` (live media both ways) and at most one `held` (paused). This module tracks ONLY
 * which call id is in which slot and the transitions between them — it is a pure function,
 * unit-testable without WebRTC or IndexedDB. The stateful call layer (`useCall.ts`) maps each
 * slot's call id to its real connection objects (pc / groupSession / meta) and drives the
 * media pause/resume; here we just decide the slot arrangement.
 */

export interface CallSlots {
  active: string | null; // callId of the active (live) call
  held: string | null; // callId of the held (paused) call
}

export const EMPTY_SLOTS: CallSlots = { active: null, held: null };

export type SlotAction =
  | { t: 'accept'; callId: string } // a newly-accepted call: hold the current one, make this active
  | { t: 'swap' } // active ⇄ held
  | { t: 'dropActive' } // end the active call; a held call resumes into active
  | { t: 'dropHeld' } // end the held call; active untouched
  | { t: 'remoteEndedHeld' }; // the remote ended the held call; free the held slot (active untouched)

export interface SlotResult {
  slots: CallSlots;
  /** True when the action could not apply and state is unchanged — currently only an
   *  `accept` at the two-call cap (the third caller is told busy by the caller). */
  rejected: boolean;
}

/** Apply one action to the slots. Pure: same inputs → same output, no side effects. */
export function reduce(state: CallSlots, action: SlotAction): SlotResult {
  switch (action.t) {
    case 'accept':
      if (state.active && state.held) return { slots: state, rejected: true }; // two-call cap
      if (!state.active) return { slots: { active: action.callId, held: null }, rejected: false };
      // Already in one call → hold it and make the new call active.
      return { slots: { active: action.callId, held: state.active }, rejected: false };
    case 'swap':
      if (!state.active || !state.held) return { slots: state, rejected: false }; // nothing to swap
      return { slots: { active: state.held, held: state.active }, rejected: false };
    case 'dropActive':
      // The held call (if any) resumes into the active slot.
      return { slots: { active: state.held, held: null }, rejected: false };
    case 'dropHeld':
    case 'remoteEndedHeld':
      return { slots: { active: state.active, held: null }, rejected: false };
  }
}
