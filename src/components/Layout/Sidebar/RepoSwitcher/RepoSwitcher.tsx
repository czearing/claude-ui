// src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.tsx
"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CaretUpDown, Check, Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRepos } from "@/hooks/useRepos";
import { AddRepoDialog } from "./AddRepoDialog";
import type { RepoSwitcherProps } from "./RepoSwitcher.types";
import styles from "./RepoSwitcher.module.css";

export function RepoSwitcher({ activeRepoId }: RepoSwitcherProps) {
  const { data: repos = [] } = useRepos();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  const activeRepo = repos.find((r) => r.id === activeRepoId);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.trigger}>
            <span className={styles.repoName}>
              {activeRepo?.name ?? "Select repo"}
            </span>
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
                onSelect={() => router.push(`/repos/${repo.id}`)}
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
          router.push(`/repos/${repoId}`);
        }}
      />
    </>
  );
}
