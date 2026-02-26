"use client";

import { useRef, useState } from "react";

import { AgentEditor } from "@/components/Agents/AgentEditor";
import { AgentList } from "@/components/Agents/AgentList";
import type { AgentScope } from "@/components/Agents/AgentList";
import { Sidebar } from "@/components/Layout/Sidebar";
import {
  useAgent,
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
} from "@/hooks/useAgents";
import styles from "./AgentsPage.module.css";

interface AgentsPageProps {
  repoId: string;
  selectedAgentName?: string;
}

export function AgentsPage({ repoId, selectedAgentName }: AgentsPageProps) {
  const [scope, setScope] = useState<AgentScope>("global");
  const [selectedName, setSelectedName] = useState<string | null>(
    selectedAgentName ?? null,
  );

  const effectiveRepoId = scope === "repo" ? repoId : undefined;

  const { data: agents = [] } = useAgents(scope, effectiveRepoId);
  const { data: selectedAgent } = useAgent(
    selectedName,
    scope,
    effectiveRepoId,
  );
  const { mutate: createAgent } = useCreateAgent(scope, effectiveRepoId);
  const { mutate: updateAgent } = useUpdateAgent(scope, effectiveRepoId);
  const { mutate: deleteAgent } = useDeleteAgent(scope, effectiveRepoId);
  const counterRef = useRef(0);

  function handleSelect(name: string | null) {
    setSelectedName(name);
    if (name) {
      window.history.replaceState(
        null,
        "",
        `/repos/${repoId}/agents/${encodeURIComponent(name)}`,
      );
    } else {
      window.history.replaceState(null, "", `/repos/${repoId}/agents`);
    }
  }

  function handleScopeChange(newScope: AgentScope) {
    setScope(newScope);
    handleSelect(null);
  }

  function handleNew() {
    let candidate = `agent-${++counterRef.current}`;
    while (agents.some((a) => a.name === candidate)) {
      candidate = `agent-${++counterRef.current}`;
    }
    createAgent(
      { name: candidate, description: "", content: "" },
      { onSuccess: () => handleSelect(candidate) },
    );
  }

  function handleRename(newName: string) {
    if (!selectedName) {
      return;
    }
    const description = selectedAgent?.description ?? "";
    const content = selectedAgent?.content ?? "";
    createAgent(
      { name: newName, description, content },
      {
        onSuccess: () => {
          deleteAgent(selectedName);
          handleSelect(newName);
        },
      },
    );
  }

  function handleDelete() {
    if (!selectedName) {
      return;
    }
    deleteAgent(selectedName, { onSuccess: () => handleSelect(null) });
  }

  function handleChange(description: string, content: string) {
    if (!selectedName) {
      return;
    }
    updateAgent({ name: selectedName, description, content });
  }

  return (
    <div className={styles.shell}>
      <Sidebar repoId={repoId} currentView="Agents" />
      <div className={styles.page}>
        <AgentList
          agents={agents}
          selectedName={selectedName}
          onSelect={handleSelect}
          onNew={handleNew}
          scope={scope}
          onScopeChange={handleScopeChange}
        />
        <div className={styles.editorPane}>
          {selectedAgent ? (
            <AgentEditor
              name={selectedAgent.name}
              description={selectedAgent.description}
              content={selectedAgent.content}
              onChange={handleChange}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ) : (
            <div className={styles.emptyState}>
              <p>Select an agent or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
