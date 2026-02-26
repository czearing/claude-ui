"use client";

import { useEffect, useRef } from "react";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { CLEAR_HISTORY_COMMAND } from "lexical";

import { preprocessMarkdown } from "./preprocessMarkdown";
import { EDITOR_TRANSFORMERS } from "./tableTransformer";

// Loads the initial value exactly once on mount.
// Captures value in a ref so that subsequent prop changes (from query
// refetches after saves) never reset the editor or lose cursor position.
// Tries legacy Lexical JSON first for backward compat, then falls back
// to treating the content as markdown.
export function ContentLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  const initialValue = useRef(value);
  useEffect(() => {
    const v = initialValue.current;
    if (!v) {
      return;
    }
    try {
      const state = editor.parseEditorState(v);
      editor.setEditorState(state);
      return;
    } catch {
      // Not JSON — treat as markdown
    }
    editor.update(() => {
      $convertFromMarkdownString(preprocessMarkdown(v), EDITOR_TRANSFORMERS);
    });
    const unregister = editor.registerUpdateListener(() => {
      unregister();
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    });
  }, [editor]);
  return null;
}
