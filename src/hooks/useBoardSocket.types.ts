import type { Task } from '@/utils/tasks.types';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export type BoardSocketEvent =
  | { type: 'task:created'; task: Task }
  | { type: 'task:updated'; task: Task }
  | { type: 'task:deleted'; id: string };

export type UseBoardSocketOptions = {
  onEvent?: (event: BoardSocketEvent) => void;
};

export type UseBoardSocketResult = {
  status: ConnectionStatus;
};
