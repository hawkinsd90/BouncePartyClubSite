import { useEffect } from 'react';

// Stops the page behind an open drawer from scrolling. The scrollbar's width is added as padding so the page does not jump sideways,
// and the previous values are restored exactly when the lock ends or the component unmounts.
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = typeof window !== 'undefined' ? window.innerWidth - document.documentElement.clientWidth : 0;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [locked]);
}

// Calls `onDismiss` for a pointer press outside `ref` and for Escape, while `active`.
export function useDismissable(ref: { current: HTMLElement | null }, active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, active, onDismiss]);
}
