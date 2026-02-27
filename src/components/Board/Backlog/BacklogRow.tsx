"use client";

import { FileText, DotsThree, Trash, Sparkle } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import type { Task } from "@/utils/tasks.types";
import styles from "./Backlog.module.css";

interface BacklogRowProps {
  task: Task;
  isSelected: boolean;
  isMenuOpen: boolean;
  onSelect: () => void;
  onSetMenuOpen: (open: boolean) => void;
  onHandover: () => void;
  onDelete: () => void;
}

export function BacklogRow({
  task,
  isSelected,
  isMenuOpen,
  onSelect,
  onSetMenuOpen,
  onHandover,
  onDelete,
}: BacklogRowProps) {
  return (
    <div
      className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
      onClick={onSelect}
    >
      <div className={styles.rowLeft}>
        <div className={styles.docIcon}>
          <FileText size={16} />
        </div>
        <div className={styles.rowContent}>
          <span
            className={`${styles.rowTitle}${!task.title ? ` ${styles.rowTitleEmpty}` : ""}`}
          >
            {task.title || "New Title"}
          </span>
        </div>
      </div>

      <div className={styles.rowActions}>
        <button
          className={styles.agentButton}
          onClick={(e) => {
            e.stopPropagation();
            onHandover();
          }}
          aria-label={`Send ${task.title} to agent`}
        >
          <Sparkle size={14} aria-hidden="true" />
          Send to Agent
        </button>
        <DropdownMenu.Root open={isMenuOpen} onOpenChange={onSetMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              className={`${styles.moreButton} ${isMenuOpen ? styles.moreButtonOpen : ""}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              aria-label={`More actions for ${task.title}`}
            >
              <DotsThree size={16} weight="bold" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            className={styles.menuContent}
            align="end"
            sideOffset={4}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu.Item
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onSelect={onDelete}
            >
              <span className={styles.menuItemLabel}>
                <Trash size={13} />
                Delete
              </span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
