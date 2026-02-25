"use client";

import { useEffect, useRef } from "react";
import {
  CodeNode,
  CodeHighlightNode,
  registerCodeHighlighting,
} from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { ListNode, ListItemNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import type { MultilineElementTransformer } from "@lexical/markdown";
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
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  TableCellHeaderStates,
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  $isTableNode,
} from "@lexical/table";
import {
  $createParagraphNode,
  $createTextNode,
  CLEAR_HISTORY_COMMAND,
} from "lexical";
import type { EditorState } from "lexical";

import { FloatingToolbarPlugin } from "./FloatingToolbarPlugin";
import styles from "./LexicalEditor.module.css";
import type { LexicalEditorProps } from "./LexicalEditor.types";
import { SlashMenuPlugin } from "./SlashMenuPlugin";

// ─── Table markdown transformer ───────────────────────────────────────────────

const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/;
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-*:? ?)+\|\s?$/;

function parseTableCells(line: string): string[] {
  return line
    .replace(/^\||\|\s?$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [TableNode, TableRowNode, TableCellNode],
  regExpStart: TABLE_ROW_REG_EXP,
  handleImportAfterStartMatch({ lines, rootNode, startLineIndex }) {
    // Consume all contiguous table rows
    let endIndex = startLineIndex;
    while (
      endIndex + 1 < lines.length &&
      TABLE_ROW_REG_EXP.test(lines[endIndex + 1])
    ) {
      endIndex++;
    }

    const tableLines = lines.slice(startLineIndex, endIndex + 1);
    const headerCells = parseTableCells(tableLines[0]);

    // Skip separator row (| --- | --- |) if present
    let dataStart = 1;
    if (
      tableLines.length > 1 &&
      TABLE_ROW_DIVIDER_REG_EXP.test(tableLines[1])
    ) {
      dataStart = 2;
    }

    const tableNode = $createTableNode();

    // Header row
    const headerRow = $createTableRowNode();
    headerCells.forEach((text) => {
      const cell = $createTableCellNode(TableCellHeaderStates.ROW);
      const para = $createParagraphNode();
      if (text) { para.append($createTextNode(text)); }
      cell.append(para);
      headerRow.append(cell);
    });
    tableNode.append(headerRow);

    // Data rows
    for (let i = dataStart; i < tableLines.length; i++) {
      const cells = parseTableCells(tableLines[i]);
      const row = $createTableRowNode();
      cells.forEach((text) => {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
        const para = $createParagraphNode();
        if (text) { para.append($createTextNode(text)); }
        cell.append(para);
        row.append(cell);
      });
      tableNode.append(row);
    }

    rootNode.append(tableNode);
    return [true, endIndex];
  },
  replace() {
    return false; // no typing shortcut for tables
  },
  export(node, traverseChildren) {
    if (!$isTableNode(node)) { return null; }

    const rows = node.getChildren();
    const lines: string[] = [];

    rows.forEach((rowNode, rowIndex) => {
      const cells = (rowNode as TableRowNode).getChildren();
      const cellTexts = cells.map((cell) =>
        traverseChildren(cell as TableCellNode)
          .replace(/\n/g, " ")
          .trim(),
      );
      lines.push(`| ${cellTexts.join(" | ")} |`);
      if (rowIndex === 0) {
        lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
      }
    });

    return lines.join("\n");
  },
};

const EDITOR_TRANSFORMERS = [TABLE, ...TRANSFORMERS];

// ──────────────────────────────────────────────────────────────────────────────

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
  table: styles.table,
  tableRow: styles.tableRow,
  tableCell: styles.tableCell,
  tableCellHeader: styles.tableCellHeader,
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
  TableNode,
  TableRowNode,
  TableCellNode,
];

// Normalise line endings and fix markdown that was corrupted by older export bugs.
// Lexical's exporter encodes whitespace adjacent to format markers as &#nn; HTML entities
// (e.g. **hello &#32;**) — but a prior version of cleanMarkdownOutput incorrectly stripped
// only the entity and left the trailing space, producing **hello ** which Lexical can no
// longer parse as bold. Fix both forms so old saves render correctly.
function preprocessMarkdown(md: string): string {
  return (
    md
      // Normalise line endings
      .replace(/\r\n/g, "\n")
      // Decode whitespace-only HTML entities written by Lexical (&#32; → space, etc.)
      .replace(/&#(\d+);/g, (_, c) => {
        const char = String.fromCharCode(parseInt(c, 10));
        return /\s/.test(char) ? char : `&#${c};`;
      })
      // Trim whitespace adjacent to format markers — invalid in CommonMark
      // (both **word ** and ** word** fail to parse as bold).
      .replace(/(\*{1,3}|_{1,3})\s+([^*_\n]+?)(\1)/g, "$1$2$3") // leading
      .replace(/(\*{1,3}|_{1,3})([^*_\n]+?)\s+(\1)/g, "$1$2$3") // trailing
  );
}

// Loads the initial value exactly once on mount.
// Captures value in a ref so that subsequent prop changes (from query
// refetches after saves) never reset the editor or lose cursor position.
// Tries legacy Lexical JSON first for backward compat, then falls back
// to treating the content as markdown.
function ContentLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  const initialValue = useRef(value);
  useEffect(() => {
    const v = initialValue.current;
    if (!v) { return; }
    // Try legacy Lexical JSON format first (backward compat)
    try {
      const state = editor.parseEditorState(v);
      editor.setEditorState(state); // setEditorState does not add to undo history
      return;
    } catch {
      // Not JSON — treat as markdown
    }
    editor.update(() => {
      $convertFromMarkdownString(preprocessMarkdown(v), EDITOR_TRANSFORMERS);
    });
    // After the markdown load flushes, clear history so Ctrl+Z starts
    // from the loaded content, not from before it was loaded.
    const unregister = editor.registerUpdateListener(() => {
      unregister();
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    });
  }, [editor]); // editor is stable for the lifetime of LexicalComposer
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
