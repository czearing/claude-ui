"use client";

import { useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { TextNode } from "lexical";
import { createPortal } from "react-dom";

import type { BlockOption } from "./blockOptions";
import { buildOptions } from "./blockOptions";
import styles from "./SlashMenuPlugin.module.css";

export function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);

  const checkForSlash = useBasicTypeaheadTriggerMatch("/", { minLength: 0 });
  const allOptions = buildOptions(editor);

  const options = queryString
    ? allOptions.filter(
        (opt) =>
          opt.title.toLowerCase().includes(queryString.toLowerCase()) ||
          opt.keywords.some((kw) => kw.includes(queryString.toLowerCase())),
      )
    : allOptions;

  const onSelectOption = (
    selected: BlockOption,
    nodeToRemove: TextNode | null,
    closeMenu: () => void,
  ) => {
    editor.update(() => {
      nodeToRemove?.remove();
      selected.onSelect();
    });
    closeMenu();
  };

  return (
    <LexicalTypeaheadMenuPlugin<BlockOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForSlash}
      options={options}
      menuRenderFn={(
        anchorRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (anchorRef.current === null || options.length === 0) {
          return null;
        }

        const rect = anchorRef.current.getBoundingClientRect();

        return createPortal(
          <div
            className={styles.menu}
            style={{ top: rect.bottom + 6, left: rect.left }}
          >
            <div className={styles.label}>Block type</div>
            <ul className={styles.list}>
              {options.map((option, i) => (
                <li
                  key={option.key}
                  className={`${styles.item} ${selectedIndex === i ? styles.selected : ""}`}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  onClick={() => {
                    setHighlightedIndex(i);
                    selectOptionAndCleanUp(option);
                  }}
                  ref={(el) => {
                    if (el && selectedIndex === i) {
                      el.scrollIntoView({ block: "nearest" });
                    }
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  <span className={styles.text}>
                    <span className={styles.title}>{option.title}</span>
                    <span className={styles.desc}>{option.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        );
      }}
    />
  );
}
