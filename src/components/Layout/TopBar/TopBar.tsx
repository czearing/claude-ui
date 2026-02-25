import { Funnel, MagnifyingGlass, Plus, Rows } from "@phosphor-icons/react";

import type { TopBarProps } from "./TopBar.types";
import styles from "./TopBar.module.css";

export function TopBar({ currentView, onNewIssue }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <div className={styles.breadcrumb}>
        <span>Claude Code</span>
        <span>/</span>
        <span className={styles.breadcrumbCurrent}>{currentView}</span>
      </div>

      <div className={styles.actions}>
        <div className={styles.searchWrapper}>
          <MagnifyingGlass size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search..."
            className={styles.searchInput}
          />
        </div>

        <button className={styles.iconButton} aria-label="Filter">
          <Funnel size={16} />
        </button>
        <button className={styles.iconButton} aria-label="View options">
          <Rows size={16} />
        </button>

        <div className={styles.divider} />

        <button className={styles.newIssueButton} onClick={onNewIssue}>
          <Plus size={16} weight="bold" />
          <span>New Issue</span>
        </button>
      </div>
    </header>
  );
}
