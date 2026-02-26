import type { MultilineElementTransformer } from "@lexical/markdown";
import { TRANSFORMERS } from "@lexical/markdown";
import {
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  $isTableNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  TableCellHeaderStates,
} from "@lexical/table";
import { $createParagraphNode, $createTextNode } from "lexical";

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
    let endIndex = startLineIndex;
    while (
      endIndex + 1 < lines.length &&
      TABLE_ROW_REG_EXP.test(lines[endIndex + 1])
    ) {
      endIndex++;
    }

    const tableLines = lines.slice(startLineIndex, endIndex + 1);
    const headerCells = parseTableCells(tableLines[0]);

    let dataStart = 1;
    if (
      tableLines.length > 1 &&
      TABLE_ROW_DIVIDER_REG_EXP.test(tableLines[1])
    ) {
      dataStart = 2;
    }

    const tableNode = $createTableNode();

    const headerRow = $createTableRowNode();
    headerCells.forEach((text) => {
      const cell = $createTableCellNode(TableCellHeaderStates.ROW);
      const para = $createParagraphNode();
      if (text) {
        para.append($createTextNode(text));
      }
      cell.append(para);
      headerRow.append(cell);
    });
    tableNode.append(headerRow);

    for (let i = dataStart; i < tableLines.length; i++) {
      const cells = parseTableCells(tableLines[i]);
      const row = $createTableRowNode();
      cells.forEach((text) => {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
        const para = $createParagraphNode();
        if (text) {
          para.append($createTextNode(text));
        }
        cell.append(para);
        row.append(cell);
      });
      tableNode.append(row);
    }

    rootNode.append(tableNode);
    return [true, endIndex];
  },
  replace() {
    return false;
  },
  export(node, traverseChildren) {
    if (!$isTableNode(node)) {
      return null;
    }

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

export const EDITOR_TRANSFORMERS = [TABLE, ...TRANSFORMERS];
