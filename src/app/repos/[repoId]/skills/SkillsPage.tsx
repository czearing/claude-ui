// src/app/repos/[repoId]/skills/SkillsPage.tsx
"use client";

import { useRef, useState } from "react";

import { Sidebar } from "@/components/Layout/Sidebar";
import { SkillEditor } from "@/components/Skills/SkillEditor";
import { SkillList } from "@/components/Skills/SkillList";
import {
  useCreateSkill,
  useDeleteSkill,
  useSkill,
  useSkills,
  useUpdateSkill,
} from "@/hooks/useSkills";
import type { SkillScope } from "@/utils/skills.client";
import styles from "./SkillsPage.module.css";

interface SkillsPageProps {
  repoId: string;
  selectedSkillName?: string;
}

export function SkillsPage({ repoId, selectedSkillName }: SkillsPageProps) {
  const [scope, setScope] = useState<SkillScope>("global");
  const [selectedName, setSelectedName] = useState<string | null>(
    selectedSkillName ?? null,
  );

  const effectiveRepoId = scope === "repo" ? repoId : undefined;

  const { data: skills = [] } = useSkills(scope, effectiveRepoId);
  const { data: selectedSkill } = useSkill(
    selectedName,
    scope,
    effectiveRepoId,
  );
  const { mutate: createSkill } = useCreateSkill(scope, effectiveRepoId);
  const { mutate: updateSkill } = useUpdateSkill(scope, effectiveRepoId);
  const { mutate: deleteSkill } = useDeleteSkill(scope, effectiveRepoId);
  const counterRef = useRef(0);

  function handleSelect(name: string | null) {
    setSelectedName(name);
    if (name) {
      window.history.replaceState(
        null,
        "",
        `/repos/${repoId}/skills/${encodeURIComponent(name)}`,
      );
    } else {
      window.history.replaceState(null, "", `/repos/${repoId}/skills`);
    }
  }

  function handleScopeChange(newScope: SkillScope) {
    setScope(newScope);
    handleSelect(null);
  }

  function handleNew() {
    let candidate = `skill-${++counterRef.current}`;
    while (skills.some((s) => s.name === candidate)) {
      candidate = `skill-${++counterRef.current}`;
    }
    createSkill(
      { name: candidate, description: "", content: "" },
      { onSuccess: () => handleSelect(candidate) },
    );
  }

  function handleRename(newName: string) {
    if (!selectedName) {
      return;
    }
    const description = selectedSkill?.description ?? "";
    const content = selectedSkill?.content ?? "";
    createSkill(
      { name: newName, description, content },
      {
        onSuccess: () => {
          deleteSkill(selectedName);
          handleSelect(newName);
        },
      },
    );
  }

  function handleDelete() {
    if (!selectedName) {
      return;
    }
    deleteSkill(selectedName, { onSuccess: () => handleSelect(null) });
  }

  function handleChange(description: string, content: string) {
    if (!selectedName) {
      return;
    }
    updateSkill({ name: selectedName, description, content });
  }

  return (
    <div className={styles.shell}>
      <Sidebar repoId={repoId} currentView="Skills" />
      <div className={styles.page}>
        <SkillList
          skills={skills}
          selectedName={selectedName}
          onSelect={handleSelect}
          onNew={handleNew}
          scope={scope}
          onScopeChange={handleScopeChange}
        />
        <div className={styles.editorPane}>
          {selectedSkill ? (
            <SkillEditor
              name={selectedSkill.name}
              description={selectedSkill.description}
              content={selectedSkill.content}
              onChange={handleChange}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ) : (
            <div className={styles.emptyState}>
              <p>Select a skill or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
