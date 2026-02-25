"use client";

import { useRepos } from "@/hooks/useRepos";
import styles from "./TopBar.module.css";
import type { TopBarProps } from "./TopBar.types";

export function TopBar({ repoId, currentView }: TopBarProps) {
  const { data: repos = [] } = useRepos();
  const repoName = repos.find((r) => r.id === repoId)?.name ?? "…";

  return (
    <header className={styles.topBar}>
      <div className={styles.breadcrumb}>
        <span>{repoName}</span>
        <span>/</span>
        <span className={styles.breadcrumbCurrent}>{currentView}</span>
      </div>
    </header>
  );
}
