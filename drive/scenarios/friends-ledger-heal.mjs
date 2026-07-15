// Spec 2040 end-to-end: a device whose connected-peers ledger is wiped (the
// recovery/reinstall state — contacts present, ledger empty) heals it from the
// server on the next connect, restoring listFriends()/close-friends.
import { createAccount, pair, poll, sweep, done } from '../driver.mjs';

const ledger = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('ring');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('settings').objectStore('settings').get('connectedPeers');
          get.onsuccess = () => { db.close(); resolve(get.result?.value ?? {}); };
          get.onerror = () => { db.close(); reject(get.error); };
        };
      }),
  );

const a = await createAccount('Heala');
const b = await createAccount('Healb');
await pair(a, b);

// Sanity: the live accept populated the ledger.
await poll(() => ledger(a.page), (v) => v[b.id] === true, { label: 'ledger has b after pair' });
console.log('[heal] ledger populated by live accept');

// Simulate recovery: wipe the ledger row (contacts stay), then reload.
await a.page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('ring');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').delete('connectedPeers');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }),
);
console.log('[heal] ledger wiped, reloading (simulated recovered install)');
await a.page.reload();
await a.page.waitForSelector('ion-tab-bar', { timeout: 30_000 });

// The boot refreshConnections() must rebuild it from ?include=friends.
await poll(() => ledger(a.page), (v) => v[b.id] === true, { label: 'ledger healed after reload' });
console.log('[heal] PASS — ledger rebuilt from the server after wipe+reload');

await sweep([a, b]);
await done();
