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
    // camera effects, reminder infra) or were redundant (calls always relay, so
    // "protect IP" was a no-op). Re-adding any of these should fail this guard.
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

  it('every external link is a real https URL (no in-app payment surface)', () => {
    const ext = everyItem().filter((i): i is Extract<SettingItem, { type: 'external' }> => i.type === 'external');
    expect(ext.length).toBeGreaterThan(0);
    for (const i of ext) expect(i.url, i.title).toMatch(/^https:\/\//);
  });

  it('the Support screen lists the contribution platforms and is searchable', () => {
    const support = settingNode('support');
    expect(support).toBeDefined();
    const urls = (support?.groups.flatMap((g) => g.items) ?? [])
      .filter((i): i is Extract<SettingItem, { type: 'external' }> => i.type === 'external')
      .map((i) => i.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://ko-fi.com/zuptalo',
        'https://liberapay.com/zuptalo',
        'https://github.com/sponsors/zuptalo',
      ]),
    );
    expect(searchSettings('ko-fi').length).toBeGreaterThan(0);
  });
});
