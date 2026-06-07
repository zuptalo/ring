import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { isAuthenticated } from '@/services/auth';

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
      { path: 'calls', component: () => import('@/views/tabs/CallsPage.vue') },
      { path: 'chats', component: () => import('@/views/tabs/ChatsPage.vue') },
      {
        path: 'contacts',
        component: () => import('@/views/tabs/ContactsPage.vue'),
      },
      { path: 'settings', component: () => import('@/views/tabs/SettingsPage.vue') },
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
    path: '/settings/:section',
    component: () => import('@/views/detail/SettingDetailPage.vue'),
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

export default router;
