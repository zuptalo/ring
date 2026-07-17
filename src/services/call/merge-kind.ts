/**
 * Pure kind-reconciliation rule for a merge (spec 1030, US1). "Video-capable"
 * means the per-participant "Turn on video" control is offered — the existing
 * group-video model (toggleVideoMode's ≤ VIDEO_MAX gate): each person opts their
 * OWN camera in; nothing is ever auto-enabled, and the 1:1 requestVideoUpgrade
 * consent flow is never used for a group. This helper encodes the decision the
 * live call machinery already enforces, so it can be exhaustively unit-tested
 * (the e2e then pins the affordance to it). Dependency-light (caps only).
 */
import { VIDEO_MAX, type CallKind } from './types';

export function videoCapableAfterMerge(activeKind: CallKind, combinedHeadcount: number): boolean {
  if (activeKind === 'video') return true; // already a video call — stays one
  return combinedHeadcount <= VIDEO_MAX; // audio: still fits video → cameras allowed
}
