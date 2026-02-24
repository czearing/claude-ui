'use client';

import { useEffect } from 'react';
import { X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';

import { useTaskMutations } from '@/hooks/useTaskMutations';
import { getTaskLog } from '@/utils/tasks.client';
import type { Task } from '@/utils/tasks.types';
import styles from './TaskDetailPanel.module.css';
import type { TaskDetailPanelProps } from './TaskDetailPanel.types';

export function TaskDetailPanel({
  taskId,
  onClose,
  className,
}: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const { patchTask, isPatching } = useTaskMutations();

  const task = taskId
    ? (queryClient.getQueryData<Task[]>(['tasks'])?.find((t) => t.id === taskId) ?? null)
    : null;

  const { data: logContent } = useQuery({
    queryKey: ['task-log', taskId],
    queryFn: () => getTaskLog(taskId!),
    enabled: taskId !== null,
    refetchInterval: task?.status === 'in_progress' ? 2000 : false,
  });

  useEffect(() => {
    if (taskId === null) {return;}
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [taskId, onClose]);

  if (taskId === null) {
    return null;
  }

  function handleCancel() {
    if (!taskId) {return;}
    void patchTask({ id: taskId, data: { status: 'backlog' } });
  }

  function handleRequeue() {
    if (!taskId) {return;}
    void patchTask({ id: taskId, data: { status: 'not_started' } });
  }

  function handleMarkDone() {
    if (!taskId) {return;}
    void patchTask({ id: taskId, data: { status: 'done' } });
  }

  return (
    <>
      <div
        className={styles.overlay}
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className={clsx(styles.panel, className)}
        role="complementary"
        aria-label="Task detail"
      >
        <div className={styles.header}>
          <span className={styles.title}>
            {task?.title ?? 'Task Detail'}
          </span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close task detail"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className={styles.body}>
          {task && (
            <>
              <div className={styles.meta}>
                <span className={clsx(styles.statusBadge, styles[`status_${task.status}`])}>
                  {task.status.replace('_', ' ')}
                </span>
              </div>
              {task.description && (
                <p className={styles.description}>{task.description}</p>
              )}
              <div className={styles.actions}>
                {task.status === 'in_progress' && (
                  <button
                    type="button"
                    className={clsx(styles.actionButton, styles.actionButtonDanger)}
                    onClick={handleCancel}
                    disabled={isPatching}
                  >
                    Cancel
                  </button>
                )}
                {task.status === 'review' && (
                  <>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={handleRequeue}
                      disabled={isPatching}
                    >
                      Re-queue
                    </button>
                    <button
                      type="button"
                      className={clsx(styles.actionButton, styles.actionButtonPrimary)}
                      onClick={handleMarkDone}
                      disabled={isPatching}
                    >
                      Mark done
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          <div className={styles.logSection}>
            <p className={styles.logLabel}>Log</p>
            <pre className={styles.log}>
              {logContent ?? 'No log output yet.'}
            </pre>
          </div>
        </div>
      </aside>
    </>
  );
}
