// Referential-integrity guards for the declarative settings tree. The renderer
// trusts that every `link` points at a real node and that the tree carries no
// dead keys (settings stored but never consumed). These caught the cleanup that
// removed placeholder screens + features the app doesn't have.
import { describe, it, expect } from 'vitest';
import { SETTINGS, YOU_SECTIONS, searchSettings, settingNode, type SettingItem } from './schema';

function everyItem(): SettingItem[] {
  const out: SettingItem[] = [];
  for (const node of Object.values(SETTINGS)) {
    for (const group of node.groups) out.push(...group.items);
  }
  return out;
}

describe('settings schema', () => {
  it('every link points at an existing node (no dangling screens)', () => {
    for (const item of everyItem()) {
      if (item.type === 'link') {
        expect(settingNode(item.id), `link "${item.title}" → ${item.id}`).toBeDefined();
      }
    }
  });

  it('every You-tab hub resolves to a node', () => {
    for (const sec of YOU_SECTIONS) {
      if (sec.id === 'about') continue; // About is its own route, not a SETTINGS node
      expect(settingNode(sec.id), sec.title).toBeDefined();
    }
  });

  it('carries no dead/removed setting keys', () => {
    // Settings removed in the cleanup: backed nothing (no Status/Stories feature,
    // camera effects, reminder infra) or were redundant at the time. protectIp in
    // particular must STAY dead even now that calls can go direct (spec 1043):
    // old encrypted own-sync snapshots may still carry a stale protectIp value
    // that would silently apply if the key were reused — the replacement is the
    // new privacy.relayCalls key. Re-adding any of these should fail this guard.
    const DEAD = [
      'privacy.status', 'privacy.statusSharing', 'privacy.protectIp', 'privacy.cameraEffects',
      'notifications.status.show', 'notifications.status.reactions', 'notifications.status.sound',
      'notifications.reminders',
    ];
    const keys = new Set(
      everyItem()
        .filter((i): i is Extract<SettingItem, { key: string }> => 'key' in i)
        .map((i) => i.key),
    );
    for (const k of DEAD) expect(keys.has(k), `dead key still present: ${k}`).toBe(false);
  });

  it('search finds a real control and never a removed one', () => {
    expect(searchSettings('hidden chats').length).toBeGreaterThan(0);
    expect(searchSettings('passkeys')).toHaveLength(0);
    expect(searchSettings('chat backup')).toHaveLength(0);
  });
});

describe('settings schema — spec 1043 (direct call media)', () => {
  it('has the "Always relay calls" toggle on the Privacy page, default off', () => {
    const items = SETTINGS.privacy.groups.flatMap((g) => g.items);
    const toggle = items.find((i) => 'key' in i && i.key === 'privacy.relayCalls');
    expect(toggle?.type).toBe('toggle');
    expect(toggle && 'default' in toggle && toggle.default).toBe(false);
  });
});

describe('settings schema — spec 1025 cleanup', () => {
  it('has exactly one Animations entry (the duplicate was removed)', () => {
    const anim = everyItem().filter((i) => 'title' in i && i.title === 'Animations');
    expect(anim).toHaveLength(1);
  });

  it('has no in-app Vibrate toggle (a PWA no-op, removed)', () => {
    const keys = new Set(
      everyItem()
        .filter((i): i is Extract<SettingItem, { key: string }> => 'key' in i)
        .map((i) => i.key),
    );
    expect(keys.has('notifications.inapp.vibrate')).toBe(false);
  });

});

describe('settings schema — spec 1026 (friends-only & refinements)', () => {
  it('US2: no "Advanced" sub-page and nothing links to it (FR-006)', () => {
    expect(settingNode('privacy-advanced')).toBeUndefined();
    expect(everyItem().some((i) => i.type === 'link' && i.id === 'privacy-advanced')).toBe(false);
  });

  it('US2: no "Block unknown account messages" control anywhere (FR-007)', () => {
    const hasBlockUnknown = everyItem().some((i) => 'key' in i && i.key === 'privacy.blockUnknown');
    expect(hasBlockUnknown).toBe(false);
  });

  it('US2: "Disable link previews" sits directly on the Privacy page (FR-008)', () => {
    const items = SETTINGS.privacy.groups.flatMap((g) => g.items);
    const toggle = items.find((i) => 'key' in i && i.key === 'privacy.disableLinkPreviews');
    expect(toggle?.type).toBe('toggle');
  });

  it('US3: Help links ≥8 how-to topics that all resolve (FR-011)', () => {
    const links = SETTINGS.help.groups
      .flatMap((g) => g.items)
      .filter((i): i is Extract<SettingItem, { type: 'link' }> => i.type === 'link' && i.id.startsWith('help-'));
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const l of links) expect(settingNode(l.id), `missing node ${l.id}`).toBeDefined();
  });

  it('US3: Help no longer shows the app version (FR-012)', () => {
    const hasStat = SETTINGS.help.groups.flatMap((g) => g.items).some((i) => i.type === 'stat');
    expect(hasStat).toBe(false);
  });

  it('US3: the developer self-test is still reachable from Help (FR-013)', () => {
    const hasSelfTest = SETTINGS.help.groups
      .flatMap((g) => g.items)
      .some((i) => i.type === 'route' && i.path === '/settings/selftest');
    expect(hasSelfTest).toBe(true);
  });

  it('US4: resetting auto-download requires confirmation (FR-014)', () => {
    const reset = everyItem().find(
      (i): i is Extract<SettingItem, { type: 'action' }> =>
        i.type === 'action' && i.action === 'reset-autodownload',
    );
    expect(reset?.confirm && reset.confirm.length > 0).toBe(true);
  });
});
