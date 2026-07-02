/**
 * Pure join-cue diff (spec 1030, US2). Each server `call-roster` update is fed
 * through this to decide who deserves a "{name} joined the call" cue: roster
 * members that are not us and have not already been announced this call. The
 * caller owns the `announced` set (per call, reset when a new call starts) and
 * appends the result to it, so a member is announced at most once per call —
 * a reconnect doesn't change room membership and a leave+rejoin re-add stays
 * silent (INV-4). Dependency-free (no WebRTC) so it is exhaustively unit-tested.
 */
export function newJoiners(
  announced: ReadonlySet<string>,
  roster: string[],
  selfId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of roster) {
    if (!id || id === selfId || announced.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
