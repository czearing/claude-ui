"use client";

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import type { EditorState } from "lexical";
import { useEffect } from "react";

import type { LexicalEditorProps } from "./LexicalEditor.types";
import styles from "./LexicalEditor.module.css";

const THEME = {
  paragraph: "",
  text: { bold: "font-bold", italic: "italic", underline: "underline" },
};

function StateLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!value) return;
    try {
      const state = editor.parseEditorState(value);
      editor.setEditorState(state);
    } catch {
      // ignore invalid state
    }
  }, [editor, value]);
  return null;
}

export function LexicalEditor({
  value,
  onChange,
  readOnly = false,
}: LexicalEditorProps) {
  const initialConfig = {
    namespace: "SpecEditor",
    theme: THEME,
    editable: !readOnly,
    onError: (error: Error) => console.error(error),
  };

  const handleChange = (editorState: EditorState) => {
    onChange?.(JSON.stringify(editorState.toJSON()));
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={styles.wrapper}>
        <RichTextPlugin
          contentEditable={<ContentEditable className={styles.editorContent} />}
          placeholder={
            <div className={styles.placeholder}>Enter spec details...</div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        {onChange && <OnChangePlugin onChange={handleChange} />}
        <StateLoader value={value} />
      </div>
    </LexicalComposer>
  );
}
