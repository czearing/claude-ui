import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Task } from '@/utils/tasks.types';
import type {
  ConnectionStatus,
  UseBoardSocketOptions,
  UseBoardSocketResult,
} from './useBoardSocket.types';

type WireMessage =
  | { type: 'snapshot'; tasks: Task[] }
  | { type: 'task_created'; task: Task }
  | { type: 'task_updated'; task: Task }
  | { type: 'task_deleted'; taskId: string };

const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export function useBoardSocket(
  options?: UseBoardSocketOptions,
): UseBoardSocketResult {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const backoffRef = useRef(BACKOFF_INITIAL_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    function connect(): void {
      if (!mountedRef.current) {return;}

      const url = `ws://${location.host}/ws/board`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {return;}
        backoffRef.current = BACKOFF_INITIAL_MS;
        setStatus('connected');
      };

      ws.onmessage = (event: MessageEvent) => {
        let msg: WireMessage;
        try {
          msg = JSON.parse(event.data as string) as WireMessage;
        } catch {
          return;
        }

        if (msg.type === 'snapshot') {
          queryClient.setQueryData<Task[]>(['tasks'], msg.tasks);
        } else if (msg.type === 'task_created') {
          queryClient.setQueryData<Task[]>(['tasks'], (old) =>
            old ? [...old, msg.task] : [msg.task],
          );
          options?.onEvent?.({ type: 'task:created', task: msg.task });
        } else if (msg.type === 'task_updated') {
          queryClient.setQueryData<Task[]>(['tasks'], (old) =>
            old
              ? old.map((t) => (t.id === msg.task.id ? msg.task : t))
              : [msg.task],
          );
          options?.onEvent?.({ type: 'task:updated', task: msg.task });
        } else if (msg.type === 'task_deleted') {
          queryClient.setQueryData<Task[]>(['tasks'], (old) =>
            old ? old.filter((t) => t.id !== msg.taskId) : [],
          );
          options?.onEvent?.({ type: 'task:deleted', id: msg.taskId });
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (!mountedRef.current) {return;}
        const wasClean = event.wasClean;
        if (wasClean) {
          setStatus('disconnected');
          return;
        }
        setStatus('reconnecting');
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (!mountedRef.current) {return;}
        setStatus('reconnecting');
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current !== null) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status };
}
