// src/hooks/useDebouncedCallback.ts
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Returns a [schedule, cancel] tuple. Calling schedule(...args) debounces the
 * callback by `delay` ms. On unmount, any pending call is flushed immediately
 * so edits are never silently dropped. The latest callback ref is always used,
 * so stable identity is not required.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
): [(...args: Args) => void, () => void] {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  const pendingArgsRef = useRef<Args | null>(null);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    return () => {
      if (timerRef.current !== null && pendingArgsRef.current !== null) {
        clearTimeout(timerRef.current);
        callbackRef.current(...pendingArgsRef.current);
      }
    };
  }, []);

  function schedule(...args: Args) {
    pendingArgsRef.current = args;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      pendingArgsRef.current = null;
      timerRef.current = null;
      callbackRef.current(...args);
    }, delay);
  }

  function cancel() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingArgsRef.current = null;
  }

  return [schedule, cancel];
}
