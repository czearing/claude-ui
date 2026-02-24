// src/hooks/useTasksSocket.ts
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const TASK_EVENTS = new Set(['task:created', 'task:updated', 'task:deleted']);

export function useTasksSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/board`);

    ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string };
        if (TASK_EVENTS.has(msg.type)) {
          void queryClient.invalidateQueries({ queryKey: ['tasks'] });
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    return () => ws.close();
  }, [queryClient]);
}
