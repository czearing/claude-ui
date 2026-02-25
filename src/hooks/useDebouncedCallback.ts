// src/hooks/useDebouncedCallback.ts
import { useEffect, useRef } from "react";

/**
 * Returns a [schedule, cancel] tuple. Calling schedule(...args) debounces the
 * callback by `delay` ms. The pending timer is automatically cleared on unmount.
 * The latest callback ref is always used, so stable identity is not required.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
): [(...args: Args) => void, () => void] {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function schedule(...args: Args) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }

  function cancel() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  return [schedule, cancel];
}
