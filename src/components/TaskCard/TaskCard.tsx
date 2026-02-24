'use client';

import { useState } from 'react';
import { DotsSixVertical } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { clsx } from 'clsx';

import { useTaskMutations } from '@/hooks/useTaskMutations';
import type { TaskStatus } from '@/utils/tasks.types';
import styles from './TaskCard.module.css';
import type { TaskCardProps } from './TaskCard.types';
import { TaskCardProgress } from './TaskCardProgress';

const ALL_STATUSES: TaskStatus[] = [
  'backlog',
  'not_started',
  'in_progress',
  'review',
  'done',
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  not_started: 'Not Started',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

export function TaskCard({ task, onOpenDetail, className }: TaskCardProps) {
  const { moveTask, deleteTask } = useTaskMutations();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState({ x: 0, y: 0 });
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isActive = task.status === 'in_progress' && task.startedAt != null;
  const targetStatuses = ALL_STATUSES.filter((s) => s !== task.status);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuCoords({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenDetail(task.id);
    }
  }

  function handleMoveTo(status: TaskStatus) {
    moveTask.mutate({ taskId: task.id, status });
  }

  function handleConfirmDelete() {
    deleteTask.mutate({ taskId: task.id });
    setDeleteOpen(false);
  }

  return (
    <>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        {/* Invisible trigger anchored at right-click coordinates */}
        <DropdownMenu.Trigger asChild>
          <span
            style={{
              position: 'fixed',
              left: menuCoords.x,
              top: menuCoords.y,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenu.Trigger>

        <div
          className={clsx(
            styles.card,
            task.errorMessage && styles.hasError,
            className,
          )}
          role="listitem"
          tabIndex={0}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          aria-label={`Task: ${task.title}`}
        >
          <div className={styles.cardInner}>
            <span className={styles.dragHandle} aria-hidden="true">
              <DotsSixVertical size={14} weight="bold" />
            </span>
            <span className={styles.title}>{task.title}</span>
          </div>

          {(task.tags?.length ?? 0) > 0 && (
            <div className={styles.meta}>
              {task.tags!.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {task.errorMessage && (
            <span className={styles.errorBadge} role="alert">
              Error
            </span>
          )}

          {isActive && (
            <TaskCardProgress
              currentAction={task.currentAction}
              startedAt={task.startedAt!}
            />
          )}
        </div>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.menu}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={styles.menuItem}>
                Move to...
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className={styles.menu}>
                  {targetStatuses.map((status) => (
                    <DropdownMenu.Item
                      key={status}
                      className={styles.menuItem}
                      onSelect={() => handleMoveTo(status)}
                    >
                      {STATUS_LABELS[status]}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>

            <DropdownMenu.Item
              className={styles.menuItem}
              onSelect={() => onOpenDetail(task.id)}
            >
              View log
            </DropdownMenu.Item>

            <DropdownMenu.Separator className={styles.menuSeparator} />

            <DropdownMenu.Item
              className={clsx(styles.menuItem, styles.menuItemDanger)}
              onSelect={() => setDeleteOpen(true)}
            >
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>
              Delete task?
            </Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              &quot;{task.title}&quot; will be permanently removed. This action
              cannot be undone.
            </Dialog.Description>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button className={styles.btnCancel} type="button">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                className={styles.btnConfirm}
                type="button"
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
