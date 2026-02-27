"use client";

import { createContext, useContext, type ReactNode } from "react";

import { toast } from "@/components/Toast";
import type { Task, TaskStatus } from "@/utils/tasks.types";

const TITLE_MAX_LENGTH = 40;

function truncateTitle(title: string): string {
  if (title.length <= TITLE_MAX_LENGTH) {return title;}
  return `${title.slice(0, TITLE_MAX_LENGTH)  }...`;
}

interface NotificationContextValue {
  notifyTransition: (task: Task, from: TaskStatus, to: TaskStatus) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const notifyTransition = (task: Task, from: TaskStatus, to: TaskStatus) => {
    const title = truncateTitle(task.title);

    if (from === "In Progress" && to === "Review") {
      toast.success(`"${title}" is ready for review`);
      return;
    }

    if (from === "Review" && to === "Done") {
      toast.success(`"${title}" is complete`);
      return;
    }

    if (
      (from === "Not Started" || from === "Backlog") &&
      to === "In Progress"
    ) {
      toast.info(`Agent started "${title}"`);
      return;
    }
  };

  return (
    <NotificationContext.Provider value={{ notifyTransition }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (ctx === null) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider",
    );
  }
  return ctx;
}
