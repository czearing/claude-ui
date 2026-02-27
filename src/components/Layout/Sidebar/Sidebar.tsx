"use client";

import {
  Archive,
  BookOpen,
  CheckSquare,
  Gear,
  Robot,
  SquaresFour,
} from "@phosphor-icons/react";
import { clsx } from "clsx";
import { useRouter } from "next/navigation";

import { useTasks } from "@/hooks/useTasks";
import { RepoSwitcher } from "./RepoSwitcher";
import styles from "./Sidebar.module.css";
import type { SidebarProps, View } from "./Sidebar.types";

interface Badge {
  count: number;
  highlight?: boolean;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badges?: Badge[];
}

function NavItem({ icon, label, active, onClick, badges }: NavItemProps) {
  const visibleBadges = badges?.filter((b) => b.count > 0) ?? [];
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
      {visibleBadges.length > 0 && (
        <span className={styles.badges}>
          {visibleBadges.map((b, i) => (
            <span
              key={i}
              className={clsx(styles.badge, b.highlight && styles.badgeActive)}
            >
              {b.count}
            </span>
          ))}
        </span>
      )}
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

export function Sidebar({ repo, currentView }: SidebarProps) {
  const router = useRouter();
  const { data: tasks = [] } = useTasks(repo ?? "");
  const agentActive = tasks.some((t) => t.status === "In Progress");
  const taskCounts = {
    boardInProgress: tasks.filter((t) => t.status === "In Progress").length,
    boardReview: tasks.filter((t) => t.status === "Review").length,
    tasks: tasks.filter((t) => t.status === "Backlog").length,
    archive: tasks.filter((t) => t.status === "Done").length,
  };
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <RepoSwitcher activeRepoName={repo ?? ""} />
      </div>

      <nav className={styles.nav}>
        {NAV_VIEWS.map(({ view, path, label, icon }) => {
          const badges: Badge[] =
            view === "Board"
              ? [
                  {
                    count: taskCounts?.boardInProgress ?? 0,
                    highlight: agentActive,
                  },
                  { count: taskCounts?.boardReview ?? 0 },
                ]
              : view === "Tasks"
                ? [{ count: taskCounts?.tasks ?? 0 }]
                : [];
          return (
            <NavItem
              key={view}
              icon={icon}
              label={label}
              active={currentView === view}
              onClick={() =>
                repo &&
                router.push(`/repos/${encodeURIComponent(repo)}/${path}`)
              }
              badges={badges}
            />
          );
        })}
        <div className={styles.navSpacer} />
        <NavItem
          icon={<Archive size={16} />}
          label="Archives"
          active={currentView === "Archive"}
          onClick={() =>
            router.push(`/repos/${encodeURIComponent(repo ?? "")}/archive`)
          }
          badges={[{ count: taskCounts?.archive ?? 0 }]}
        />
      </nav>

      <div className={styles.footer}>
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
