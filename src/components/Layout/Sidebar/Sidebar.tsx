"use client";

import {
  Archive,
  BookOpen,
  CheckSquare,
  Gear,
  Robot,
  SquaresFour,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useRouter } from "next/navigation";

import { RepoSwitcher } from "./RepoSwitcher";
import styles from "./Sidebar.module.css";
import type { SidebarProps, View } from "./Sidebar.types";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        styles.navItem,
        active ? styles.navItemActive : styles.navItemInactive,
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

const NAV_VIEWS: {
  view: View;
  path: string;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    view: "Board",
    path: "board",
    label: "Board",
    icon: <SquaresFour size={16} />,
  },
  {
    view: "Tasks",
    path: "tasks",
    label: "Tasks",
    icon: <CheckSquare size={16} />,
  },
  {
    view: "Skills",
    path: "skills",
    label: "Skills",
    icon: <BookOpen size={16} />,
  },
  {
    view: "Agents",
    path: "agents",
    label: "Agents",
    icon: <Robot size={16} />,
  },
];

export function Sidebar({
  repoId,
  currentView,
  agentActive = false,
}: SidebarProps) {
  const router = useRouter();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <RepoSwitcher activeRepoId={repoId ?? ""} />
      </div>

      <nav className={styles.nav}>
        {NAV_VIEWS.map(({ view, path, label, icon }) => (
          <NavItem
            key={view}
            icon={icon}
            label={label}
            active={currentView === view}
            onClick={() => repoId && router.push(`/repos/${repoId}/${path}`)}
          />
        ))}
      </nav>

      <div className={styles.footer}>
        <NavItem
          icon={<Archive size={16} />}
          label="Archives"
          active={currentView === "Archive"}
          onClick={() => router.push(`/repos/${repoId}/archive`)}
        />
        <div className={styles.agentStatus}>
          <span className={styles.agentLabel}>Agent Status</span>
          <div className={styles.agentIndicator}>
            <span className={styles.agentIndicatorText}>
              {agentActive ? "Active" : "Idle"}
            </span>
            <div
              className={clsx(
                styles.dot,
                agentActive ? styles.dotActive : styles.dotIdle,
              )}
            />
          </div>
        </div>
        <NavItem icon={<Gear size={16} />} label="Settings" />
      </div>
    </aside>
  );
}
