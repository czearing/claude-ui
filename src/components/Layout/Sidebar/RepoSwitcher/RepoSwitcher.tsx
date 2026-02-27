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

export function RepoSwitcher({ activeRepoName }: RepoSwitcherProps) {
  const { data: repos = [] } = useRepos();
  const router = useRouter();
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);

  const activeRepo = repos.find((r) => r.name === activeRepoName);
  const knownSegments = ["board", "tasks", "archive", "agents", "skills"];
  const viewSegment =
    knownSegments.find((s) => pathname.includes(`/${s}`)) ?? "board";

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          {/* suppressHydrationWarning: Radix generates the button id via
              React's useId, which produces different values between the
              Next.js App Router SSR pass and client hydration. Without
              this attribute React throws a non-patchable hydration error
              and tears down the entire component tree (visible as a page
              reload). The id is only used for ARIA aria-controls linking
              so the mismatch has no functional impact. */}
          <button className={styles.trigger} suppressHydrationWarning>
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
                onSelect={() =>
                  router.push(
                    `/repos/${encodeURIComponent(repo.name)}/${viewSegment}`,
                  )
                }
              >
                <span className={styles.itemName}>{repo.name}</span>
                {repo.name === activeRepoName && (
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
        onCreated={(repoName) => {
          setAddOpen(false);
          router.push(`/repos/${encodeURIComponent(repoName)}/board`);
        }}
      />
    </>
  );
}
