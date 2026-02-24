'use client';

import { useState, useEffect } from 'react';
import { Plus, Terminal, Funnel } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';

import styles from './CommandPalette.module.css';
import type { CommandPaletteProps } from './CommandPalette.types';

const FILTER_LABELS = [
  'Backlog',
  'Not Started',
  'In Progress',
  'Review',
  'Done',
] as const;

export function CommandPalette({ className }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleNewTask() {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('claude-code-ui:new-task'));
  }

  function handleGoToTerminal() {
    setOpen(false);
    router.push('/terminal');
  }

  function handleFilter(label: string) {
    setOpen(false);
    console.warn('[CommandPalette] filter:', label);
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <Command
        className={clsx(styles.dialog, className)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Command palette"
      >
        <Command.Input
          className={styles.input}
          placeholder="Type a command or search..."
          autoFocus
        />
        <Command.List className={styles.list}>
          <Command.Empty className={styles.empty}>
            No results found.
          </Command.Empty>
          <Command.Group heading="Actions" className={styles.group}>
            <Command.Item
              className={styles.item}
              onSelect={handleNewTask}
            >
              <Plus size={14} weight="bold" className={styles.itemIcon} />
              New task
            </Command.Item>
            <Command.Item
              className={styles.item}
              onSelect={handleGoToTerminal}
            >
              <Terminal size={14} weight="bold" className={styles.itemIcon} />
              Go to terminal
            </Command.Item>
          </Command.Group>
          <Command.Group heading="Filter" className={styles.group}>
            {FILTER_LABELS.map((label) => (
              <Command.Item
                key={label}
                className={styles.item}
                onSelect={() => handleFilter(label)}
              >
                <Funnel size={14} weight="bold" className={styles.itemIcon} />
                Filter: {label}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
