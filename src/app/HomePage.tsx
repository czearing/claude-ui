"use client";

import { useRouter } from "next/navigation";

import { InstanceCard } from "@/components";
import { useSessionStore } from "@/hooks/useSessionStore";

import styles from "./HomePage.module.css";
import type { Session } from "@/hooks/useSessionStore";

export const HomePage = () => {
  const router = useRouter();
  const { sessions, addSession, deleteSession } = useSessionStore();

  function handleNewInstance() {
    const session = addSession();
    router.push(`/session/${session.id}`);
  }

  function handleOpen(session: Session) {
    router.push(`/session/${session.id}`);
  }

  function handleDelete(id: string) {
    void deleteSession(id);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Claude Instances</h1>
        <button
          type="button"
          className={styles.newButton}
          onClick={handleNewInstance}
        >
          New Instance
        </button>
      </header>
      <main className={styles.main}>
        {sessions.length === 0 ? (
          <p className={styles.emptyState}>
            No instances yet. Click &ldquo;New Instance&rdquo; to start.
          </p>
        ) : (
          <ul className={styles.grid} aria-label="Claude instances">
            {sessions.map((session) => (
              <li key={session.id} className={styles.gridItem}>
                <InstanceCard
                  session={session}
                  onOpen={handleOpen}
                  onDelete={handleDelete}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};
