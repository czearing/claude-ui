// src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.tsx
"use client";

import { useState } from "react";
import { CaretUpDown, Check, Kanban, Plus } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { usePathname, useRouter } from "next/navigation";

import { useRepos } from "@/hooks/useRepos";
import { AddRepoDialog } from "./AddRepoDialog";
import styles from "./RepoSwitcher.module.css";
import type { RepoSwitcherProps } from "./RepoSwitcher.types";

export function RepoSwitcher({ activeRepoId }: RepoSwitcherProps) {
  const { data: repos = [] } = useRepos();
  const router = useRouter();
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);

  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const viewSegment = pathname.endsWith("/backlog") ? "backlog" : "board";

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.trigger}>
            <div className={styles.triggerLeft}>
              <div className={styles.icon}>
                <Kanban size={14} color="white" weight="bold" />
              </div>
              <span className={styles.repoName}>
                {activeRepo?.name ?? "Select repo"}
              </span>
            </div>
            <CaretUpDown size={12} className={styles.caret} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.menu}
            side="bottom"
            align="start"
            sideOffset={4}
          >
            {repos.map((repo) => (
              <DropdownMenu.Item
                key={repo.id}
                className={styles.item}
                onSelect={() => router.push(`/repos/${repo.id}/${viewSegment}`)}
              >
                <span className={styles.itemName}>{repo.name}</span>
                {repo.id === activeRepoId && (
                  <Check size={12} className={styles.checkIcon} />
                )}
              </DropdownMenu.Item>
            ))}

            {repos.length > 0 && (
              <DropdownMenu.Separator className={styles.separator} />
            )}

            <DropdownMenu.Item
              className={styles.addItem}
              onSelect={() => setAddOpen(true)}
            >
              <Plus size={12} />
              <span>Add repo</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <AddRepoDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(repoId) => {
          setAddOpen(false);
          router.push(`/repos/${repoId}/board`);
        }}
      />
    </>
  );
}
