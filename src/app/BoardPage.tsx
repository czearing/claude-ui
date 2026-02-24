'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { AppNav } from '@/components/AppNav';
import { Board } from '@/components/Board';
import { CommandPalette } from '@/components/CommandPalette';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import { useBoardSocket } from '@/hooks/useBoardSocket';
import { useTaskMutations } from '@/hooks/useTaskMutations';
import { getTasks } from '@/utils/tasks.client';
import type { TaskStatus } from '@/utils/tasks.types';
import styles from './BoardPage.module.css';

export function BoardPage() {
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: getTasks,
  });

  useBoardSocket();

  const { moveTask } = useTaskMutations();

  useEffect(() => {
    const handler = () => setCreateDialogOpen(true);
    window.addEventListener('claude-code-ui:new-task', handler);
    return () => window.removeEventListener('claude-code-ui:new-task', handler);
  }, []);

  function handleMoveTask(taskId: string, newStatus: TaskStatus, newOrder: number) {
    moveTask.mutate({ taskId, status: newStatus, columnOrder: newOrder });
  }

  return (
    <div className={styles.page}>
      <AppNav />
      <main className={styles.main}>
        <div className={styles.boardHeader}>
          <h1 className={styles.boardTitle}>Task Board</h1>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className={styles.newTaskBtn}
            type="button"
          >
            New task
          </button>
        </div>
        <Board tasks={tasks} onOpenDetail={setDetailTaskId} onMoveTask={handleMoveTask} />
      </main>
      <TaskDetailPanel taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />
      <CreateTaskDialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} />
      <CommandPalette />
    </div>
  );
}
