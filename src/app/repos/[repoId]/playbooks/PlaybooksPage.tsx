// src/app/repos/[repoId]/playbooks/PlaybooksPage.tsx
"use client";

import { useRef, useState } from "react";

import { Sidebar } from "@/components/Layout/Sidebar";
import { PlaybookEditor } from "@/components/Playbooks/PlaybookEditor";
import { PlaybookList } from "@/components/Playbooks/PlaybookList";
import {
  useCreatePlaybook,
  useDeletePlaybook,
  usePlaybook,
  usePlaybooks,
  useUpdatePlaybook,
} from "@/hooks/usePlaybooks";

import styles from "./PlaybooksPage.module.css";

interface PlaybooksPageProps {
  repoId: string;
}

export function PlaybooksPage({ repoId }: PlaybooksPageProps) {
  const { data: playbooks = [] } = usePlaybooks();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const { data: selectedPlaybook } = usePlaybook(selectedName);
  const { mutate: createPlaybook } = useCreatePlaybook();
  const { mutate: updatePlaybook } = useUpdatePlaybook();
  const { mutate: deletePlaybook } = useDeletePlaybook();
  const counterRef = useRef(0);

  function handleNew() {
    let candidate = `playbook-${++counterRef.current}`;
    while (playbooks.some((p) => p.name === candidate)) {
      candidate = `playbook-${++counterRef.current}`;
    }
    createPlaybook(
      { name: candidate, content: "" },
      { onSuccess: () => setSelectedName(candidate) },
    );
  }

  function handleRename(newName: string) {
    if (!selectedName) return;
    const content = selectedPlaybook?.content ?? "";
    createPlaybook(
      { name: newName, content },
      {
        onSuccess: () => {
          deletePlaybook(selectedName);
          setSelectedName(newName);
        },
      },
    );
  }

  function handleDelete() {
    if (!selectedName) return;
    deletePlaybook(selectedName, { onSuccess: () => setSelectedName(null) });
  }

  function handleChange(content: string) {
    if (!selectedName) return;
    updatePlaybook({ name: selectedName, content });
  }

  return (
    <div className={styles.shell}>
      <Sidebar repoId={repoId} currentView="Playbooks" />
      <div className={styles.page}>
        <PlaybookList
          playbooks={playbooks}
          selectedName={selectedName}
          onSelect={setSelectedName}
          onNew={handleNew}
        />
        <div className={styles.editorPane}>
          {selectedPlaybook ? (
            <PlaybookEditor
              name={selectedPlaybook.name}
              content={selectedPlaybook.content}
              onChange={handleChange}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ) : (
            <div className={styles.emptyState}>
              <p>Select a playbook or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
