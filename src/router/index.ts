import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { isAuthenticated } from '@/services/auth';
// The four bottom-tab pages are eager-loaded (static imports), NOT lazy
// `() => import()` chunks. They are the app's core surface, reached within
// seconds of launch and already SW-precached; lazy-splitting them only bought a
// first-switch chunk-fetch stall that rendered the tab in pieces. Folding them
// into the entry graph means the first switch has no fetch/parse delay (spec 1001).
import CallsPage from '@/views/tabs/CallsPage.vue';
import ChatsPage from '@/views/tabs/ChatsPage.vue';
import ContactsPage from '@/views/tabs/ContactsPage.vue';
import SettingsPage from '@/views/tabs/SettingsPage.vue';

const routes: RouteRecordRaw[] = [
  // Land inside the tabs; the guard below bounces unauthenticated users to the
  // Auth tab, so that becomes the effective landing page until they register.
  { path: '/', redirect: '/tabs/chats' },
  {
    path: '/notifications',
    name: 'notifications',
    component: () => import('@/views/NotificationsPage.vue'),
  },
  // Auth lives OUTSIDE the tabs (a top-level full-screen route, like the detail
  // pages). It used to be a button-less child of <ion-tabs>, but leaving a tab with
  // no tab button never fires ion-tabs' leave transition on iOS WebKit, so after
  // the post-sign-in onboarding the Auth page stayed stuck on top of Chats until the
  // user tapped a tab. As a sibling of /tabs in the root outlet, entering the app is
  // an ordinary outlet replacement that tears the Auth page down everywhere.
  {
    path: '/auth',
    name: 'auth',
    component: () => import('@/views/tabs/AuthPage.vue'),
  },
  {
    path: '/tabs',
    component: () => import('@/views/TabsPage.vue'),
    children: [
      { path: '', redirect: '/tabs/chats' },
      { path: 'calls', component: CallsPage },
      { path: 'chats', component: ChatsPage },
      { path: 'wall', component: () => import('@/views/tabs/WallPage.vue') },
      { path: 'contacts', component: ContactsPage },
      { path: 'settings', component: SettingsPage },
      // Backward-compat for old links/bookmarks to the former "You" tab.
      { path: 'you', redirect: '/tabs/settings' },
    ],
  },
  // Detail pages live OUTSIDE the tabs so they push full-screen and hide the
  // bottom tab bar (WhatsApp-style drill-down).
  {
    path: '/chat/:id',
    component: () => import('@/views/detail/ChatDetailPage.vue'),
  },
  {
    path: '/chat/:id/info/:messageId',
    component: () => import('@/views/detail/MessageInfoPage.vue'),
  },
  {
    path: '/chat/:id/media',
    component: () => import('@/views/detail/AllMediaPage.vue'),
  },
  {
    path: '/chat/:id/starred',
    component: () => import('@/views/detail/StarredPage.vue'),
  },
  {
    path: '/contact/:id',
    component: () => import('@/views/detail/ContactDetailPage.vue'),
  },
  {
    path: '/new-group',
    component: () => import('@/views/detail/NewGroupPage.vue'),
  },
  {
    path: '/new-group-call',
    component: () => import('@/views/detail/NewGroupCallPage.vue'),
  },
  {
    path: '/chats/archived',
    component: () => import('@/views/detail/ArchivedChatsPage.vue'),
  },
  {
    path: '/chats/locked',
    component: () => import('@/views/detail/LockedChatsPage.vue'),
  },
  {
    path: '/group/:id',
    component: () => import('@/views/detail/GroupInfoPage.vue'),
  },
  {
    path: '/call/:contactId',
    component: () => import('@/views/detail/CallDetailPage.vue'),
  },
  {
    // Full-screen in-call UI (1:1 and group); shown while a call is active.
    path: '/call-active',
    component: () => import('@/views/detail/CallActivePage.vue'),
  },
  // Literal settings pages must precede the generic :section matcher.
  {
    path: '/settings/profile',
    component: () => import('@/views/detail/ProfilePage.vue'),
  },
  {
    path: '/settings/storage-manage',
    component: () => import('@/views/detail/StorageManagePage.vue'),
  },
  {
    path: '/settings/network-usage',
    component: () => import('@/views/detail/NetworkUsagePage.vue'),
  },
  {
    path: '/settings/qr',
    component: () => import('@/views/detail/ContactQrPage.vue'),
  },
  {
    path: '/scan',
    component: () => import('@/views/detail/ScanPage.vue'),
  },
  {
    path: '/add-contact',
    component: () => import('@/views/detail/AddByIdPage.vue'),
  },
  {
    path: '/directory',
    component: () => import('@/views/detail/DirectoryPage.vue'),
  },
  {
    path: '/settings/selftest',
    component: () => import('@/views/detail/SelfTestPage.vue'),
  },
  {
    path: '/settings/about',
    component: () => import('@/views/detail/AboutPage.vue'),
  },
  {
    path: '/settings/calls-declines',
    component: () => import('@/views/detail/CallsDeclinesPage.vue'),
  },
  // Social Wall (spec 0003). The feed lives in the bottom tab bar (/tabs/wall);
  // compose + post detail push full-screen over it. Old /wall links redirect in.
  {
    path: '/wall',
    redirect: '/tabs/wall',
  },
  {
    path: '/wall/compose',
    component: () => import('@/views/detail/PostComposerPage.vue'),
  },
  {
    path: '/wall/post/:id',
    component: () => import('@/views/detail/PostDetailPage.vue'),
  },
  {
    path: '/wall/muted',
    component: () => import('@/views/detail/WallManagePage.vue'),
  },
  {
    path: '/settings/close-friends',
    component: () => import('@/views/detail/CloseFriendsPage.vue'),
  },
  {
    path: '/settings/:section',
    component: () => import('@/views/detail/SettingDetailPage.vue'),
  },
  // Catch-all (spec 2010): any path that doesn't match a real screen redirects to the main list
  // instead of rendering a blank view — so a stale/unknown URL (or a history entry the OS back-swipe
  // pops to) always resolves to something in-app, never an empty document.
  {
    path: '/:pathMatch(.*)*',
    redirect: '/tabs/chats',
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// Auth gate. The Auth page (/auth, top-level) is the only public area; everything
// else requires a registered device.
//  - Unauthenticated → any protected route redirects to /auth.
//  - Authenticated   → /auth redirects into the app (Chats).
// Drop focus from whatever was tapped (an ion-item's native button, etc.)
// before each transition. Otherwise Ionic marks the outgoing page aria-hidden
// while it still contains the focused element, which assistive tech flags
// ("Blocked aria-hidden on an element because its descendant retained focus").
router.beforeEach(() => {
  const el = document.activeElement as HTMLElement | null;
  if (el && typeof el.blur === 'function') el.blur();
});

router.beforeEach((to) => {
  const authed = isAuthenticated.value;
  if (to.path === '/auth') {
    return authed ? '/tabs/chats' : true;
  }
  if (!authed) {
    return '/auth';
  }
  return true;
});

// Tabs are terminal (WhatsApp-style): the iOS PWA back-swipe walks the browser
// history (Ionic's own swipe-back is off — see main.ts), so switching tabs must not
// pile up entries. This used to be enforced here by a beforeEach guard that re-issued
// every navigation INTO a tab root as a plain Vue-Router `replace`. That bare replace
// stripped the per-tab metadata Ionic's native tab switch (`changeTab`) attaches and
// left the nested tabs outlet's transition direction ambiguous: once you'd drilled
// into a detail page (e.g. Contacts → a contact → a chat) and backed out, the leftover
// forward history desynced the outlet from the tab bar — the tapped tab highlighted but
// its page never transitioned in until you visited another tab first.
//
// The flattening now lives where the tab is actually tapped (TabsPage switchTab), which
// routes through Ionic's own router with an explicit 'root' direction + 'replace' action
// (the same call AuthPage uses to enter the app). That keeps the history flat AND gives
// the outlet an unambiguous root transition, so highlight and page stay in lockstep.
export default router;
