"use client";

import { useEffect, useState } from "react";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  Code,
  Link,
} from "@phosphor-icons/react";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { createPortal } from "react-dom";

import styles from "./FloatingToolbarPlugin.module.css";

interface ToolbarState {
  top: number;
  left: number;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikethrough: boolean;
  isCode: boolean;
  isLink: boolean;
}

export function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);

  const readToolbar = () => {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
      setToolbar(null);
      return;
    }

    const node = selection.anchor.getNode();
    const parent = node.getParent();
    const isLink = $isLinkNode(parent) || $isLinkNode(node);

    const nativeSelection = window.getSelection();
    if (!nativeSelection || nativeSelection.rangeCount === 0) {
      setToolbar(null);
      return;
    }

    const range = nativeSelection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0) {
      setToolbar(null);
      return;
    }

    setToolbar({
      top: rect.top - 48,
      left: rect.left + rect.width / 2,
      isBold: selection.hasFormat("bold"),
      isItalic: selection.hasFormat("italic"),
      isUnderline: selection.hasFormat("underline"),
      isStrikethrough: selection.hasFormat("strikethrough"),
      isCode: selection.hasFormat("code"),
      isLink,
    });
  };

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        readToolbar();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(readToolbar);
    });
  }, [editor]);

  if (!toolbar) {
    return null;
  }

  const {
    top,
    left,
    isBold,
    isItalic,
    isUnderline,
    isStrikethrough,
    isCode,
    isLink,
  } = toolbar;

  const handleLink = () => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    } else {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, "https://");
    }
  };

  return createPortal(
    <div
      className={styles.toolbar}
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        className={`${styles.btn} ${isBold ? styles.active : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
        }}
        aria-label="Bold"
        title="Bold"
      >
        <TextB size={14} weight="bold" />
      </button>
      <button
        className={`${styles.btn} ${isItalic ? styles.active : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
        }}
        aria-label="Italic"
        title="Italic"
      >
        <TextItalic size={14} weight="bold" />
      </button>
      <button
        className={`${styles.btn} ${isUnderline ? styles.active : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
        }}
        aria-label="Underline"
        title="Underline"
      >
        <TextUnderline size={14} weight="bold" />
      </button>
      <button
        className={`${styles.btn} ${isStrikethrough ? styles.active : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
        }}
        aria-label="Strikethrough"
        title="Strikethrough"
      >
        <TextStrikethrough size={14} weight="bold" />
      </button>
      <div className={styles.divider} />
      <button
        className={`${styles.btn} ${isCode ? styles.active : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
        }}
        aria-label="Inline code"
        title="Inline code"
      >
        <Code size={14} weight="bold" />
      </button>
      <button
        className={`${styles.btn} ${isLink ? styles.active : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          handleLink();
        }}
        aria-label="Link"
        title="Link"
      >
        <Link size={14} weight="bold" />
      </button>
    </div>,
    document.body,
  );
}
