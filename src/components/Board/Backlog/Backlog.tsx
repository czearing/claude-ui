'use client';

import { Code, FileText, Plus } from '@phosphor-icons/react';
import clsx from 'clsx';
import { useState } from 'react';

import { useCreateTask, useTasks } from '@/hooks/useTasks';
import { useTasksSocket } from '@/hooks/useTasksSocket';
import type { Task, TaskType } from '@/utils/tasks.types';
import { TaskCard } from '../TaskCard';
import styles from './Backlog.module.css';

interface BacklogProps {
  onSelectTask: (task: Task) => void;
}

export function Backlog({ onSelectTask }: BacklogProps) {
  useTasksSocket();

  const { data: allTasks = [] } = useTasks();
  const { mutate: createTask } = useCreateTask();
  const backlogTasks = allTasks.filter(t => t.status === 'Backlog');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftType, setDraftType] = useState<TaskType>('Spec');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle.trim()) return;
    createTask({ title: draftTitle.trim(), type: draftType, priority: 'Medium', status: 'Backlog' });
    setDraftTitle('');
  };

  return (
    <div className={styles.backlog}>
      <div className={styles.inner}>
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>Backlog</h1>
          <span className={styles.count}>{backlogTasks.length} issues</span>
        </div>

        <form onSubmit={handleSubmit} className={styles.createForm}>
          <Plus size={20} color="var(--color-text-muted)" />
          <input
            type="text"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="Create a new draft..."
            className={styles.createInput}
          />
          <div className={styles.typeToggle}>
            {(['Spec', 'Develop'] as TaskType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setDraftType(t)}
                className={clsx(styles.typeButton, draftType === t && styles.typeButtonActive)}
              >
                {t === 'Spec' ? <FileText size={12} /> : <Code size={12} />}
                {t}
              </button>
            ))}
          </div>
          <button type="submit" disabled={!draftTitle.trim()} className={styles.addButton}>
            Add
          </button>
        </form>

        <div className={styles.list}>
          {backlogTasks.map(task => (
            <TaskCard key={task.id} task={task} onSelect={onSelectTask} />
          ))}
          {backlogTasks.length === 0 && (
            <div className={styles.emptyState}>No issues in the backlog. Create a draft above to get started.</div>
          )}
        </div>
      </div>
    </div>
  );
}
