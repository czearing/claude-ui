"use client";

import { $convertToMarkdownString } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import type { EditorState } from "lexical";

import { CodeHighlightPlugin } from "./CodeHighlightPlugin";
import { ContentLoader } from "./ContentLoader";
import { FloatingToolbarPlugin } from "./FloatingToolbarPlugin";
import { NODES, THEME } from "./lexicalConfig";
import styles from "./LexicalEditor.module.css";
import type { LexicalEditorProps } from "./LexicalEditor.types";
import { SlashMenuPlugin } from "./SlashMenuPlugin";
import { EDITOR_TRANSFORMERS } from "./tableTransformer";

export function LexicalEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = "Write something, or press '/' for commands…",
  format = "json",
}: LexicalEditorProps) {
  const initialConfig = {
    namespace: "SpecEditor",
    theme: THEME,
    nodes: NODES,
    editable: !readOnly,
    onError: (error: Error) => console.error(error),
  };

  const handleChange = (editorState: EditorState) => {
    if (format === "markdown") {
      editorState.read(() => {
        onChange?.($convertToMarkdownString(EDITOR_TRANSFORMERS));
      });
    } else {
      onChange?.(JSON.stringify(editorState.toJSON()));
    }
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={styles.wrapper}>
        <RichTextPlugin
          contentEditable={<ContentEditable className={styles.editorContent} />}
          placeholder={<div className={styles.placeholder}>{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <CodeHighlightPlugin />
        {!readOnly && <ListPlugin />}
        {!readOnly && <LinkPlugin />}
        {!readOnly && <TablePlugin hasCellMerge={false} />}
        {!readOnly && (
          <MarkdownShortcutPlugin transformers={EDITOR_TRANSFORMERS} />
        )}
        {!readOnly && <FloatingToolbarPlugin />}
        {!readOnly && <SlashMenuPlugin />}
        {onChange && (
          <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        )}
        <ContentLoader value={value} />
      </div>
    </LexicalComposer>
  );
}
