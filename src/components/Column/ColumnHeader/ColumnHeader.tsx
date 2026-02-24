import { Lightning } from '@phosphor-icons/react';
import { clsx } from 'clsx';

import styles from './ColumnHeader.module.css';
import type { ColumnHeaderProps } from './ColumnHeader.types';

export function ColumnHeader({
  label,
  count,
  accentColor,
  isAutomated,
  hasActiveAgent,
  className,
}: ColumnHeaderProps) {
  return (
    <div className={clsx(styles.header, className)}>
      <span
        className={styles.accent}
        style={{ background: accentColor }}
        aria-hidden="true"
      />
      <span className={styles.label}>{label}</span>
      {isAutomated && (
        <Lightning
          className={styles.lightningIcon}
          size={12}
          weight="fill"
          aria-label="Automated column"
        />
      )}
      <span className={styles.count} aria-label={`${count} tasks`}>
        {count}
      </span>
      {isAutomated && hasActiveAgent && (
        <span className={styles.agentDot} aria-label="Agent active" />
      )}
    </div>
  );
}
