import { useEffect, useReducer } from 'react';

function formatElapsed(startedAt: string): string {
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export function useElapsedTime(startedAt: string | undefined): string | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (startedAt === undefined) {
      return;
    }

    const id = setInterval(() => tick(), 10_000);

    return () => clearInterval(id);
  }, [startedAt]);

  return startedAt !== undefined ? formatElapsed(startedAt) : null;
}
