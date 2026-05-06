import { useEffect, type RefObject } from 'react';

/*
 * useModalA11y — handles focus trap, focus restore, Esc-to-close,
 * and iOS-safe body scroll lock for a modal dialog.
 *
 * iOS scroll lock: setting `body.style.overflow = 'hidden'` is broken
 * on iOS Safari (page can still scroll, and scroll position is lost
 * on close). The `position: fixed; top: -scrollY` pattern preserves
 * position and actually freezes scroll across all browsers.
 */
export function useModalA11y(
  shellRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null;

    const focusTimer = window.setTimeout(() => {
      shellRef.current?.focus();
    }, 0);

    const scrollY = window.scrollY;
    const body = document.body;
    const previousStyles = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const shell = shellRef.current;
      if (!shell) return;
      const focusables = Array.from(
        shell.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      body.style.position = previousStyles.position;
      body.style.top = previousStyles.top;
      body.style.width = previousStyles.width;
      body.style.overflow = previousStyles.overflow;
      window.scrollTo(0, scrollY);
      previousActive?.focus?.();
    };
  }, [shellRef, onClose]);
}
