// src/components/Skills/SkillList/SkillList.tsx
"use client";

import { Plus } from "@phosphor-icons/react";
import clsx from "clsx";

import styles from "./SkillList.module.css";
import type { SkillListProps } from "./SkillList.types";

export function SkillList({
  skills,
  selectedName,
  onSelect,
  onNew,
  scope,
  onScopeChange,
  title = "Skills",
  className,
}: SkillListProps) {
  return (
    <div className={clsx(styles.list, className)}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <button
          className={styles.newButton}
          onClick={onNew}
          aria-label={`New ${title.toLowerCase().replace(/s$/, "")}`}
        >
          <Plus size={12} weight="bold" />
          New
        </button>
      </div>
      <div className={styles.scopeToggle}>
        <button
          className={clsx(
            styles.scopeBtn,
            scope === "global" && styles.scopeBtnActive,
          )}
          onClick={() => onScopeChange("global")}
        >
          Global
        </button>
        <button
          className={clsx(
            styles.scopeBtn,
            scope === "repo" && styles.scopeBtnActive,
          )}
          onClick={() => onScopeChange("repo")}
        >
          Repo
        </button>
      </div>
      <div className={styles.items}>
        {skills.length === 0 && (
          <p className={styles.empty}>No {title.toLowerCase()} yet.</p>
        )}
        {skills.map(({ name }) => (
          <button
            key={name}
            className={clsx(
              styles.item,
              selectedName === name && styles.itemSelected,
            )}
            onClick={() => onSelect(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
