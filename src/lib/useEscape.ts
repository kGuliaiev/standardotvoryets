'use client';

import { useEffect } from 'react';

/**
 * Subscribes a callback to the Escape key while `active` is true.
 * Use in components that render a modal/overlay so users can close with Esc.
 */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}
