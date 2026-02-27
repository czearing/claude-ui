"use client";

import styles from "./TopBar.module.css";
import type { TopBarProps } from "./TopBar.types";

export function TopBar({ repo, currentView }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <div className={styles.breadcrumb}>
        <span>{repo}</span>
        <span>/</span>
        <span className={styles.breadcrumbCurrent}>{currentView}</span>
      </div>
    </header>
  );
}
