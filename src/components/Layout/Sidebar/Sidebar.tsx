import {
  Archive,
  CheckSquare,
  Gear,
  Kanban,
  SquaresFour,
} from "@phosphor-icons/react";
import clsx from "clsx";

import type { SidebarProps, View } from "./Sidebar.types";
import styles from "./Sidebar.module.css";

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

const NAV_VIEWS: { view: View; label: string; icon: React.ReactNode }[] = [
  { view: "Board", label: "Board", icon: <SquaresFour size={16} /> },
  { view: "Backlog", label: "Backlog", icon: <CheckSquare size={16} /> },
];

export function Sidebar({
  currentView,
  agentActive,
  onViewChange,
}: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <Kanban size={14} color="white" weight="bold" />
        </div>
        <span className={styles.logoText}>Claude Code</span>
      </div>

      <nav className={styles.nav}>
        {NAV_VIEWS.map(({ view, label, icon }) => (
          <NavItem
            key={view}
            icon={icon}
            label={label}
            active={currentView === view}
            onClick={() => onViewChange(view)}
          />
        ))}
        <NavItem icon={<Archive size={16} />} label="Archives" />
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
