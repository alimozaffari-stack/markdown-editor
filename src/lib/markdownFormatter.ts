/**
 * Markdown Table & Document Formatter and Auto-Repair Utility
 */

export interface FormatTableOptions {
  minWidth?: number;
}

/**
 * Formats a single Markdown table string to align columns cleanly.
 */
export function formatMarkdownTable(tableText: string): string {
  const lines = tableText.trim().split(/\r?\n/);
  if (lines.length < 2) return tableText;

  // Split line into cells, handling escaped pipes \|
  const parseRow = (line: string): string[] => {
    let trimmed = line.trim();
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);

    // Split by pipe, taking care of escaped pipes \|
    const rawCells = trimmed.split(/(?<!\\)\|/);
    return rawCells.map((c) => c.trim());
  };

  const rows = lines.map(parseRow);
  if (rows.length < 2) return tableText;

  // Find separator row (index 1 usually, or row matching /^[:\-\s|]+$/)
  let separatorIdx = rows.findIndex(
    (row, idx) =>
      idx > 0 &&
      row.length > 0 &&
      row.every((cell) => /^:?-+:?$/.test(cell.replace(/\s+/g, "")))
  );

  if (separatorIdx === -1) {
    // Check if second row looks like a separator even if not strict
    if (/^[:\-\s|]+$/.test(lines[1])) {
      separatorIdx = 1;
    } else {
      return tableText; // Not a valid pipe table
    }
  }

  const numCols = Math.max(...rows.map((r) => r.length));
  if (numCols === 0) return tableText;

  // Parse column alignments from separator row
  const alignments: ("left" | "center" | "right")[] = [];
  const sepRow = rows[separatorIdx] || [];

  for (let c = 0; c < numCols; c++) {
    const sepCell = (sepRow[c] || "---").replace(/\s+/g, "");
    const starts = sepCell.startsWith(":");
    const ends = sepCell.endsWith(":");
    if (starts && ends) {
      alignments.push("center");
    } else if (ends) {
      alignments.push("right");
    } else {
      alignments.push("left");
    }
  }

  // Calculate maximum cell widths per column
  const colWidths: number[] = new Array(numCols).fill(3);

  rows.forEach((row, rowIdx) => {
    if (rowIdx === separatorIdx) return; // Ignore separator line in width calc
    for (let c = 0; c < numCols; c++) {
      const cellText = row[c] || "";
      // Unescape \| for length calculation
      const displayLength = cellText.replace(/\\\|/g, "|").length;
      colWidths[c] = Math.max(colWidths[c], displayLength);
    }
  });

  // Pad text helper
  const padCell = (text: string, width: number, align: "left" | "center" | "right"): string => {
    const len = text.replace(/\\\|/g, "|").length;
    const diff = Math.max(0, width - len);

    if (align === "right") {
      return " ".repeat(diff) + text;
    }
    if (align === "center") {
      const leftPad = Math.floor(diff / 2);
      const rightPad = diff - leftPad;
      return " ".repeat(leftPad) + text + " ".repeat(rightPad);
    }
    return text + " ".repeat(diff);
  };

  // Build formatted rows
  const formattedLines: string[] = [];

  rows.forEach((row, rowIdx) => {
    if (rowIdx === separatorIdx) {
      // Build clean separator cell
      const sepCells = alignments.map((align, c) => {
        const width = colWidths[c];
        if (align === "center") {
          return ":" + "-".repeat(Math.max(1, width - 2)) + ":";
        }
        if (align === "right") {
          return "-".repeat(Math.max(2, width - 1)) + ":";
        }
        return ":" + "-".repeat(Math.max(2, width - 1));
      });
      formattedLines.push("| " + sepCells.join(" | ") + " |");
    } else {
      const formattedCells = [];
      for (let c = 0; c < numCols; c++) {
        const cellText = row[c] || "";
        const align = alignments[c] || "left";
        formattedCells.push(padCell(cellText, colWidths[c], align));
      }
      formattedLines.push("| " + formattedCells.join(" | ") + " |");
    }
  });

  return formattedLines.join("\n");
}

/**
 * Scans markdown text and formats all Markdown tables found.
 */
export function formatAllTablesInMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      const tableText = tableBuffer.join("\n");
      const formatted = formatMarkdownTable(tableText);
      result.push(...formatted.split("\n"));
      tableBuffer = [];
    }
  };

  const isTableLine = (line: string): boolean => {
    const trimmed = line.trim();
    // Must contain pipe and not be inside code block or plain text without pipes
    return (
      (trimmed.startsWith("|") || trimmed.endsWith("|") || (trimmed.includes("|") && trimmed.includes("-"))) &&
      trimmed.split("|").length >= 3
    );
  };

  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock;
      flushTable();
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (isTableLine(line)) {
      tableBuffer.push(line);
    } else {
      flushTable();
      result.push(line);
    }
  }

  flushTable();
  return result.join("\n");
}

/**
 * Auto-check and repair Markdown formatting issues (broken tables, heading spaces, unclosed code blocks, etc.)
 */
export function repairMarkdownText(markdown: string): string {
  if (!markdown) return markdown;

  let text = markdown;

  // 1. Format and align all markdown tables
  text = formatAllTablesInMarkdown(text);

  const lines = text.split(/\r?\n/);
  const repairedLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockCount = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Track code blocks
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock;
      codeBlockCount++;
      repairedLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      repairedLines.push(line);
      continue;
    }

    // Fix headings missing space after #: e.g., "#Heading" -> "# Heading" (ignoring #tags or hex colors if isolated)
    line = line.replace(/^(\s{0,3}#{1,6})([^\s#].*)$/, (match, hashes, rest) => {
      // Don't modify if it looks like a hex color or hashtag inside word
      if (/^[0-9a-fA-F]{3,6}$/.test(rest.trim())) return match;
      return `${hashes} ${rest}`;
    });

    // Fix blockquotes missing space after >: e.g., ">Quote" -> "> Quote"
    line = line.replace(/^(\s{0,3}>)([^\s>].*)$/, "$1 $2");

    // Fix unordered lists missing space: e.g., "-Item" -> "- Item" (unless horizontal rule like ---)
    if (!/^\s*[-*_]{3,}\s*$/.test(line)) {
      line = line.replace(/^(\s*[-*+])([^\s\-*+].*)$/, "$1 $2");
    }

    // Fix task list items missing space: e.g., "-[ ]" -> "- [ ]" or "-[x]" -> "- [x]"
    line = line.replace(/^(\s*[-*+])\[([ xX])\]/, "$1 [$2]");

    // Fix ordered list items missing space: e.g., "1.Item" -> "1. Item"
    line = line.replace(/^(\s*\d+\.)([^\s\d].*)$/, "$1 $2");

    // Trim trailing whitespace from line
    line = line.trimEnd();

    repairedLines.push(line);
  }

  // If code block is unclosed (odd count), close it at the end
  if (inCodeBlock || codeBlockCount % 2 !== 0) {
    repairedLines.push("```");
  }

  let result = repairedLines.join("\n");

  // Normalize excessive blank lines (more than 2 consecutive newlines -> 2 newlines)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}
