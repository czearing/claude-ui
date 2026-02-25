"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { $createCodeNode } from "@lexical/code";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  TextT,
  TextHOne,
  TextHTwo,
  TextHThree,
  ListBullets,
  ListNumbers,
  Quotes,
  Code,
} from "@phosphor-icons/react";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  type TextNode,
} from "lexical";
import { createPortal } from "react-dom";

import styles from "./SlashMenuPlugin.module.css";

class BlockOption extends MenuOption {
  constructor(
    public readonly title: string,
    public readonly description: string,
    public readonly icon: ReactNode,
    public readonly keywords: string[],
    public readonly onSelect: () => void,
  ) {
    super(title);
  }
}

function buildOptions(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
): BlockOption[] {
  return [
    new BlockOption(
      "Text",
      "Plain paragraph",
      <TextT size={16} />,
      ["text", "paragraph", "p"],
      () => {
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            $setBlocksType(sel, () => $createParagraphNode());
          }
        });
      },
    ),
    new BlockOption(
      "Heading 1",
      "Large section heading",
      <TextHOne size={16} />,
      ["h1", "heading"],
      () => {
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            $setBlocksType(sel, () => $createHeadingNode("h1"));
          }
        });
      },
    ),
    new BlockOption(
      "Heading 2",
      "Medium section heading",
      <TextHTwo size={16} />,
      ["h2", "heading"],
      () => {
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            $setBlocksType(sel, () => $createHeadingNode("h2"));
          }
        });
      },
    ),
    new BlockOption(
      "Heading 3",
      "Small section heading",
      <TextHThree size={16} />,
      ["h3", "heading"],
      () => {
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            $setBlocksType(sel, () => $createHeadingNode("h3"));
          }
        });
      },
    ),
    new BlockOption(
      "Bullet List",
      "Unordered list",
      <ListBullets size={16} />,
      ["bullet", "ul", "list"],
      () => {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      },
    ),
    new BlockOption(
      "Numbered List",
      "Ordered list",
      <ListNumbers size={16} />,
      ["numbered", "ol", "list"],
      () => {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      },
    ),
    new BlockOption(
      "Quote",
      "Capture a quote",
      <Quotes size={16} />,
      ["quote", "blockquote"],
      () => {
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            $setBlocksType(sel, () => $createQuoteNode());
          }
        });
      },
    ),
    new BlockOption(
      "Code Block",
      "Monospace code block",
      <Code size={16} />,
      ["code", "pre"],
      () => {
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            $setBlocksType(sel, () => $createCodeNode());
          }
        });
      },
    ),
  ];
}

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
