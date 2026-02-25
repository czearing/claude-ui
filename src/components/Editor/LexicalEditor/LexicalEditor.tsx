"use client";

import { useEffect, useRef } from "react";
import {
  CodeNode,
  CodeHighlightNode,
  registerCodeHighlighting,
} from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { ListNode, ListItemNode } from "@lexical/list";
import { TRANSFORMERS } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { EditorState } from "lexical";

import { FloatingToolbarPlugin } from "./FloatingToolbarPlugin";
import styles from "./LexicalEditor.module.css";
import type { LexicalEditorProps } from "./LexicalEditor.types";
import { SlashMenuPlugin } from "./SlashMenuPlugin";

const THEME = {
  paragraph: styles.paragraph,
  heading: {
    h1: styles.h1,
    h2: styles.h2,
    h3: styles.h3,
  },
  text: {
    bold: styles.bold,
    italic: styles.italic,
    underline: styles.underline,
    strikethrough: styles.strikethrough,
    underlineStrikethrough: styles.underlineStrikethrough,
    code: styles.inlineCode,
  },
  quote: styles.quote,
  list: {
    ol: styles.ol,
    ul: styles.ul,
    listitem: styles.listItem,
    nested: {
      listitem: styles.nestedListItem,
    },
  },
  link: styles.link,
  code: styles.codeBlock,
  codeHighlight: {
    atrule: styles.tokenAttr,
    attr: styles.tokenAttr,
    boolean: styles.tokenProperty,
    builtin: styles.tokenSelector,
    cdata: styles.tokenComment,
    char: styles.tokenSelector,
    class: styles.tokenFunction,
    "class-name": styles.tokenFunction,
    comment: styles.tokenComment,
    constant: styles.tokenProperty,
    deleted: styles.tokenProperty,
    doctype: styles.tokenComment,
    entity: styles.tokenOperator,
    function: styles.tokenFunction,
    important: styles.tokenVariable,
    inserted: styles.tokenSelector,
    keyword: styles.tokenAttr,
    namespace: styles.tokenVariable,
    number: styles.tokenProperty,
    operator: styles.tokenOperator,
    prolog: styles.tokenComment,
    property: styles.tokenProperty,
    punctuation: styles.tokenPunctuation,
    regex: styles.tokenVariable,
    selector: styles.tokenSelector,
    string: styles.tokenSelector,
    symbol: styles.tokenProperty,
    tag: styles.tokenProperty,
    url: styles.tokenOperator,
    variable: styles.tokenVariable,
  },
};

const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
];

// Only loads the initial value once on mount.
// Without the guard, every onChange fires setSpec → value prop changes →
// editor.setEditorState() resets the whole editor, losing cursor and focus.
function StateLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || !value) {
      return;
    }
    didInitRef.current = true;
    try {
      const state = editor.parseEditorState(value);
      editor.setEditorState(state);
    } catch {
      // ignore invalid state
    }
  }, [editor, value]);
  return null;
}

function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return registerCodeHighlighting(editor);
  }, [editor]);
  return null;
}

export function LexicalEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = "Write something, or press '/' for commands…",
}: LexicalEditorProps) {
  const initialConfig = {
    namespace: "SpecEditor",
    theme: THEME,
    nodes: NODES,
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
          placeholder={<div className={styles.placeholder}>{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <CodeHighlightPlugin />
        {!readOnly && <ListPlugin />}
        {!readOnly && <LinkPlugin />}
        {!readOnly && <MarkdownShortcutPlugin transformers={TRANSFORMERS} />}
        {!readOnly && <FloatingToolbarPlugin />}
        {!readOnly && <SlashMenuPlugin />}
        {onChange && <OnChangePlugin onChange={handleChange} />}
        <StateLoader value={value} />
      </div>
    </LexicalComposer>
  );
}
