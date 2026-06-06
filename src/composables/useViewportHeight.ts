/**
 * Keeps the app sized to the *visible* viewport so the on-screen keyboard
 * never pushes the fixed header/footer off-screen on iOS Safari (PWA + browser).
 *
 * Background: iOS only shrinks the visual viewport when the keyboard opens, not
 * the layout viewport, and inputs inside an ion-footer aren't covered by
 * Ionic's scrollAssist (which only handles inputs within ion-content). So the
 * browser scrolls the window to reveal the footer input, shoving the header up.
 *
 * Fix: mirror `visualViewport.height` into `--app-height` and size `ion-app` to
 * it (see theme/variables.css). When the keyboard opens the app shrinks to the
 * area above it (header pinned at top, footer just above the keyboard) and the
 * window has no reason to scroll. No-ops where visualViewport is unavailable.
 */
import { onMounted, onScopeDispose } from 'vue';

export function useViewportHeight() {
  onMounted(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Tallest viewport seen = the keyboard-closed height. Some iOS devices (e.g.
    // iPhone 15 Pro) shrink window.innerHeight together with the visual viewport
    // when the keyboard opens, so `innerHeight - vv.height` stays ~0 and never
    // trips the keyboard signal. Comparing against this stable baseline does.
    let baselineHeight = 0;

    const apply = () => {
      document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
      baselineHeight = Math.max(baselineHeight, vv.height);
      // Re-pin the window to the top so the keyboard can't scroll the header
      // away, EXCEPT when an OTP field is focused. The OTP row sits on a page
      // with no pinned header and lets the browser settle it above the keyboard;
      // forcing scroll there fights that. The focused element is the OTP's
      // internal <input> (light DOM), so match its ion-input-otp ancestor.
      const inOtp = !!document.activeElement?.closest?.('ion-input-otp');
      if (!inOtp && window.scrollY !== 0) window.scrollTo(0, 0);
      // The visible viewport shrinking well below the keyboard-closed baseline is
      // a reliable keyboard signal. Flag it on <body> so the bottom tab bar can
      // hide while the keyboard is up (otherwise it floats above the keyboard),
      // and so the chat footer can drop its home-indicator safe-area inset (which
      // iOS still reports even though the keyboard now covers that area).
      const keyboardOpen = baselineHeight - vv.height > 150;
      document.body.classList.toggle('keyboard-open', keyboardOpen);
    };

    apply();
    // Listen only to 'resize' (the keyboard show/hide changes vv.height), NOT
    // 'scroll'. ion-input-otp moves focus between boxes on every keystroke,
    // which makes iOS scroll the focused box into view and fire vv 'scroll';
    // during the blur→focus handoff document.activeElement is briefly <body>,
    // so the inOtp guard fails and scrollTo(0,0) fires, fighting the keyboard
    // reveal and bouncing the page. vv.height doesn't change on scroll, so the
    // scroll listener contributed nothing but that race.
    vv.addEventListener('resize', apply);

    // Older iOS (e.g. iPhone 8): focusing an input inside an ion-footer (the chat
    // composer) makes iOS scroll the window up to reveal it AFTER the resize has
    // settled, so `apply`'s re-pin never runs again and the footer floats up the
    // screen, leaving a gap above the keyboard. Catch that late scroll and re-pin.
    // Scoped to ion-footer focus on purpose: that's the only input not in an
    // ion-content (so not covered by the resize path), and it keeps this off the
    // ion-input-otp box-to-box handoff that made us drop the 'scroll' listener
    // above (OTP fields live on a page with no ion-footer).
    const onFooterScroll = () => {
      if (!document.activeElement?.closest?.('ion-footer')) return;
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    vv.addEventListener('scroll', onFooterScroll);
    onScopeDispose(() => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', onFooterScroll);
    });
  });
}
