'use client';

import { PaperPlaneTilt, Robot, User, X } from '@phosphor-icons/react';
import { useState } from 'react';

import { useHandoverTask, useUpdateTask } from '@/hooks/useTasks';
import { LexicalEditor } from '../LexicalEditor';
import type { SpecEditorProps } from './SpecEditor.types';
import styles from './SpecEditor.module.css';

export function SpecEditor({ task, onClose }: SpecEditorProps) {
  const { mutate: updateTask } = useUpdateTask();
  const { mutate: handoverTask, isPending: isHandingOver } = useHandoverTask();

  const [spec, setSpec] = useState(task?.spec ?? '');
  const [isEditing, setIsEditing] = useState(!task?.spec);

  if (!task) return null;

  const isBacklog = task.status === 'Backlog';
  const isReview = task.status === 'Review';

  const handleSave = () => {
    updateTask({ id: task.id, spec });
    setIsEditing(false);
  };

  const handleHandover = () => {
    updateTask({ id: task.id, spec });
    handoverTask(task.id, { onSuccess: onClose });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <span className={styles.taskId}>{task.id}</span>
          <h2 className={styles.taskTitle}>{task.title}</h2>
        </div>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.statusRow}>
          <div className={styles.statusItem}>
            <div className={styles.dotAgent} />
            <span>Status: {task.status}</span>
          </div>
          <div className={styles.statusItem}>
            <div className={styles.dotOrange} />
            <span>Priority: {task.priority}</span>
          </div>
        </div>

        <div className={styles.editorWrapper}>
          <div className={styles.editorToolbar}>
            <span className={styles.editorLabel}>Specification</span>
            {isBacklog && (
              <button className={styles.editToggle} onClick={() => setIsEditing(v => !v)}>
                {isEditing ? 'Preview' : 'Edit'}
              </button>
            )}
          </div>
          <div className={styles.editorBody}>
            <LexicalEditor
              key={`${task.id}-${isEditing ? 'edit' : 'read'}`}
              value={spec}
              onChange={isEditing ? setSpec : undefined}
              readOnly={!isEditing}
            />
          </div>
        </div>

        {isReview && (
          <div className={styles.agentNotes}>
            <div className={styles.agentNotesTitle}>
              <Robot size={16} />
              <span>Agent Notes</span>
            </div>
            <p className={styles.agentNotesText}>
              Implementation complete according to the spec. Please review the changes in the terminal.
            </p>
            {task.sessionId && (
              <a href={`/session/${task.sessionId}`} className={styles.viewDiffButton} style={{ textDecoration: 'none', display: 'inline-block' }}>
                Open Terminal
              </a>
            )}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerMeta}>
          <User size={16} />
          <span>You are editing</span>
        </div>
        <div className={styles.footerActions}>
          {isEditing && isBacklog && (
            <button className={styles.saveDraftButton} onClick={handleSave}>
              Save Draft
            </button>
          )}
          {isBacklog && (
            <button className={styles.handoverButton} onClick={handleHandover} disabled={isHandingOver}>
              <PaperPlaneTilt size={16} />
              <span>{isHandingOver ? 'Starting...' : 'Handover to Claude'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
