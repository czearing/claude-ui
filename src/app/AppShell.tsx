'use client';

import { useState } from 'react';

import { Backlog } from '@/components/Board/Backlog';
import { Board } from '@/components/Board/Board';
import { SpecEditor } from '@/components/Editor/SpecEditor';
import { Sidebar, type View } from '@/components/Layout/Sidebar';
import { TopBar } from '@/components/Layout/TopBar';
import { NewIssueModal } from '@/components/Modals/NewIssueModal';
import { useTasks } from '@/hooks/useTasks';
import type { Task } from '@/utils/tasks.types';
import styles from './AppShell.module.css';

export function AppShell() {
  const { data: tasks = [] } = useTasks();
  const [currentView, setCurrentView] = useState<View>('Board');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newIssueOpen, setNewIssueOpen] = useState(false);

  const agentActive = tasks.some(t => t.status === 'In Progress');

  return (
    <div className={styles.shell}>
      <Sidebar currentView={currentView} agentActive={agentActive} onViewChange={setCurrentView} />

      <main className={styles.main}>
        <TopBar currentView={currentView} onNewIssue={() => setNewIssueOpen(true)} />

        <div className={styles.content}>
          {currentView === 'Board' ? (
            <Board tasks={tasks.filter(t => t.status !== 'Backlog')} onSelectTask={setSelectedTask} />
          ) : (
            <Backlog onSelectTask={setSelectedTask} />
          )}

          {selectedTask && <div className={styles.backdrop} onClick={() => setSelectedTask(null)} />}

          <SpecEditor task={selectedTask} onClose={() => setSelectedTask(null)} />
        </div>
      </main>

      <NewIssueModal open={newIssueOpen} onClose={() => setNewIssueOpen(false)} />
    </div>
  );
}
