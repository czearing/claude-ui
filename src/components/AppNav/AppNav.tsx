'use client';

import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Task } from '@/utils/tasks.types';
import styles from './AppNav.module.css';
import type { AppNavProps } from './AppNav.types';

export function AppNav({ className }: AppNavProps) {
  const pathname = usePathname();

  const { data: tasks } = useQuery<Task[]>({ queryKey: ['tasks'] });

  const inProgressCount =
    tasks?.filter((t) => t.status === 'in_progress').length ?? 0;

  return (
    <nav className={clsx(styles.nav, className)} aria-label="App navigation">
      <Link href="/" className={styles.brand}>
        Claude Code
      </Link>
      <div className={styles.links}>
        <Link
          href="/"
          className={clsx(styles.link, pathname === '/' && styles.linkActive)}
        >
          Board
          {inProgressCount > 0 && (
            <span className={styles.badge} aria-label={`${inProgressCount} in progress`}>
              {inProgressCount}
            </span>
          )}
        </Link>
        <Link
          href="/terminal"
          className={clsx(
            styles.link,
            pathname === '/terminal' && styles.linkActive,
          )}
        >
          Terminal
        </Link>
      </div>
    </nav>
  );
}
