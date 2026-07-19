import { Component, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HotTable, HotTableClass } from "@handsontable/react";
import { HyperFormula } from "hyperformula";
import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";
import { api } from "../../lib/api";

type SpreadsheetValue = string | number | boolean | null;
type SpreadsheetMap = Record<string, SpreadsheetValue>;

type WorkbookSheet = {
  engineSheetId: number;
  id: string;
  lockedCells: string[];
  name: string;
};

type SelectionBounds = {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
};

type PivotConfig = {
  aggregation: "avg" | "count" | "max" | "min" | "sum";
  columnField: string;
  rowField: string;
  valueField: string;
};

type SelectionSummary = {
  average: number | null;
  count: number;
  max: number | null;
  min: number | null;
  numericCount: number;
  sum: number | null;
};

type RibbonIconName =
  | "align-bottom"
  | "align-center"
  | "align-left"
  | "align-middle"
  | "align-right"
  | "align-top"
  | "bold"
  | "border"
  | "copy"
  | "cut"
  | "fill"
  | "filter"
  | "find"
  | "font-down"
  | "font-color"
  | "font-up"
  | "format-painter"
  | "freeze-col"
  | "freeze-row"
  | "italic"
  | "merge"
  | "paste"
  | "pivot"
  | "redo"
  | "save"
  | "sort-asc"
  | "sort-desc"
  | "styles"
  | "sum"
  | "table"
  | "underline"
  | "undo"
  | "unmerge"
  | "wrap";

type FormulaSuggestion = {
  description: string;
  name: string;
  signature: string;
};

type FormulaSuggestionOverlay = {
  left: number;
  top: number;
  width: number;
};

type CellFormatMeta = {
  correctFormat?: boolean;
  dateFormat?: string;
  excelClasses?: string;
  numericFormat?: { pattern: string };
  type?: string;
};

type ClipboardPayload = {
  data: string[][];
  meta: CellFormatMeta[][];
};

type SelectionUiState = {
  align: "left" | "center" | "right" | null;
  border: boolean;
  bold: boolean;
  fillColor: string | null;
  fontFamily: string;
  fontSize: string;
  italic: boolean;
  textColor: string | null;
  underline: boolean;
  verticalAlign: "top" | "middle" | "bottom" | null;
  wrap: boolean;
};

type RibbonTabName = "Home" | "Insert" | "Page Layout" | "Formulas" | "Data" | "Review" | "View";

export type ExcelAssessmentSubmission = {
  activity_log: ActivityLogEntry[];
  calculated_values_json: SpreadsheetMap;
  editable_cells: string[];
  final_sheet_json: SpreadsheetMap;
  formulas_json: SpreadsheetMap;
  locked_cells: string[];
  submitted_at: string;
};

export type ActivityLogEntry = {
  cell?: string;
  from?: unknown;
  timestamp: string;
  to?: unknown;
  type: string;
};

type ExcelSimulatorProps = {
  candidateMode?: boolean;
  description?: string;
  embedded?: boolean;
  expectedFormulas?: SpreadsheetMap;
  expectedValues?: SpreadsheetMap;
  initialSheet?: SpreadsheetMap;
  instructions?: string;
  lockedCells?: string[];
  onAutosave?: (submission: ExcelAssessmentSubmission) => void;
  onSubmit?: (submission: ExcelAssessmentSubmission) => void | Promise<void>;
  readOnly?: boolean;
  showTopbarActions?: boolean;
  title?: string;
};

const INITIAL_ROWS = 180;
const INITIAL_COLS = 90;
const MIN_SPARE_ROWS = 50;
const MIN_SPARE_COLS = 36;
const DEFAULT_LOCKED = ["A1", "B1", "A2", "B2", "A3", "B3", "A4", "A5"];

const DEFAULT_SHEET: SpreadsheetMap = {
  A1: "Metric",
  B1: "Value",
  A2: "Sales",
  B2: 125000,
  A3: "Cost",
  B3: 76000,
  A4: "Profit",
  B4: "=B2-B3",
  A5: "Margin %",
  B5: "=ROUND(B4/B2,3)",
};

const COLOR_SWATCHES = [
  "#1f2937",
  "#2563eb",
  "#0f766e",
  "#107c41",
  "#b45309",
  "#dc2626",
  "#7c3aed",
  "#f8fafc",
];

const NUMBER_FORMAT_OPTIONS = [
  { label: "General", patch: {} },
  { label: "Number", patch: { type: "numeric", numericFormat: { pattern: "0,0.00" } } },
  { label: "Number (0 decimals)", patch: { type: "numeric", numericFormat: { pattern: "0,0" } } },
  { label: "Comma", patch: { type: "numeric", numericFormat: { pattern: "0,0.00" } } },
  { label: "Currency", patch: { type: "numeric", numericFormat: { pattern: "$0,0.00" } } },
  { label: "Accounting", patch: { type: "numeric", numericFormat: { pattern: "$ 0,0.00" } } },
  { label: "Percent", patch: { type: "numeric", numericFormat: { pattern: "0.00%" } } },
  { label: "Percent (0 decimals)", patch: { type: "numeric", numericFormat: { pattern: "0%" } } },
  { label: "Scientific", patch: { type: "numeric", numericFormat: { pattern: "0.00E+00" } } },
  { label: "Fraction", patch: { type: "numeric", numericFormat: { pattern: "# ?/?" } } },
  { label: "Text", patch: { type: "text" } },
  { label: "Short Date", patch: { type: "date", dateFormat: "YYYY-MM-DD", correctFormat: true } },
  { label: "Long Date", patch: { type: "date", dateFormat: "dddd, MMMM D, YYYY", correctFormat: true } },
  { label: "Date Time", patch: { type: "date", dateFormat: "YYYY-MM-DD HH:mm", correctFormat: true } },
  { label: "Time", patch: { type: "date", dateFormat: "HH:mm", correctFormat: true } },
  { label: "Month Year", patch: { type: "date", dateFormat: "MMM YYYY", correctFormat: true } },
  { label: "Day Month", patch: { type: "date", dateFormat: "D MMM", correctFormat: true } },
  { label: "ISO Date", patch: { type: "date", dateFormat: "YYYY-MM-DD", correctFormat: true } },
  { label: "Duration", patch: { type: "date", dateFormat: "[h]:mm:ss", correctFormat: true } },
  { label: "Custom 4-decimal", patch: { type: "numeric", numericFormat: { pattern: "0,0.0000" } } },
];

const FORMULA_SUGGESTIONS: FormulaSuggestion[] = [
  { name: "SUM", signature: "SUM(number1, [number2], ...)", description: "Adds numbers or ranges" },
  { name: "AVERAGE", signature: "AVERAGE(number1, [number2], ...)", description: "Returns the arithmetic mean" },
  { name: "COUNT", signature: "COUNT(value1, [value2], ...)", description: "Counts numeric cells" },
  { name: "COUNTA", signature: "COUNTA(value1, [value2], ...)", description: "Counts non-empty cells" },
  { name: "IF", signature: "IF(logical_test, value_if_true, value_if_false)", description: "Returns one value or another based on a test" },
  { name: "SUMIF", signature: "SUMIF(range, criteria, [sum_range])", description: "Adds values matching a condition" },
  { name: "COUNTIF", signature: "COUNTIF(range, criteria)", description: "Counts values matching a condition" },
  { name: "ROUND", signature: "ROUND(number, num_digits)", description: "Rounds a number to a set precision" },
  { name: "MAX", signature: "MAX(number1, [number2], ...)", description: "Returns the largest value" },
  { name: "MIN", signature: "MIN(number1, [number2], ...)", description: "Returns the smallest value" },
  { name: "VLOOKUP", signature: "VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])", description: "Looks up a value in a table" },
  { name: "XLOOKUP", signature: "XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])", description: "Looks up a value with flexible matching" },
  { name: "CONCAT", signature: "CONCAT(text1, [text2], ...)", description: "Joins text values together" },
  { name: "LEFT", signature: "LEFT(text, [num_chars])", description: "Returns characters from the left side" },
  { name: "RIGHT", signature: "RIGHT(text, [num_chars])", description: "Returns characters from the right side" },
  { name: "MID", signature: "MID(text, start_num, num_chars)", description: "Returns characters from the middle of text" },
  { name: "LEN", signature: "LEN(text)", description: "Counts characters in text" },
  { name: "TODAY", signature: "TODAY()", description: "Returns the current date" },
  { name: "DATE", signature: "DATE(year, month, day)", description: "Builds a date from parts" },
];

function getFormulaSearchToken(value: string): string {
  const match = /(?:^|[=,(+\-*/\s])([A-Z][A-Z0-9]*)$/i.exec(value.trim());
  return match?.[1]?.toUpperCase() || "";
}

function colLabel(col: number): string {
  let label = "";
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function refFor(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`;
}

function parseRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

function computeGridSize(map: SpreadsheetMap) {
  let maxRow = INITIAL_ROWS - 1;
  let maxCol = INITIAL_COLS - 1;
  Object.keys(map || {}).forEach((ref) => {
    const pos = parseRef(ref);
    if (!pos) return;
    maxRow = Math.max(maxRow, pos.row + 20);
    maxCol = Math.max(maxCol, pos.col + 12);
  });
  return {
    rows: Math.max(INITIAL_ROWS, maxRow + 1),
    cols: Math.max(INITIAL_COLS, maxCol + 1),
  };
}

function createBlankData(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
}

function mapToData(map: SpreadsheetMap, rows: number, cols: number): string[][] {
  const data = createBlankData(rows, cols);
  Object.entries(map || {}).forEach(([ref, value]) => {
    const pos = parseRef(ref);
    if (!pos || pos.row >= rows || pos.col >= cols) return;
    data[pos.row][pos.col] = value == null ? "" : String(value);
  });
  return data;
}

function dataToMap(data: unknown[][], sheetName: string): SpreadsheetMap {
  const out: SpreadsheetMap = {};
  (data || []).forEach((row, r) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, c) => {
      if (value === "" || value == null) return;
      out[`${sheetName}!${refFor(r, c)}`] = typeof value === "number" || typeof value === "boolean" ? value : String(value);
    });
  });
  return out;
}

function collectUsedBounds(data: unknown[][]) {
  let maxRow = -1;
  let maxCol = -1;
  (data || []).forEach((row, rowIndex) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, colIndex) => {
      if (value == null || String(value).trim() === "") return;
      maxRow = Math.max(maxRow, rowIndex);
      maxCol = Math.max(maxCol, colIndex);
    });
  });
  return {
    maxRow: maxRow >= 0 ? maxRow : 0,
    maxCol: maxCol >= 0 ? maxCol : 0,
  };
}

function normalizeCells(cells?: string[]): string[] {
  return Array.from(new Set((cells || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean)));
}

function parseClassTokens(value: unknown): string[] {
  return String(value || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildSelectionBounds(selection: number[] | null | undefined): SelectionBounds | null {
  if (!selection || selection.length < 4) return null;
  const [row1, col1, row2, col2] = selection;
  return {
    r1: Math.min(row1, row2),
    c1: Math.min(col1, col2),
    r2: Math.max(row1, row2),
    c2: Math.max(col1, col2),
  };
}

function getUniqueSheetName(existingNames: string[], base = "Sheet") {
  let index = 1;
  let candidate = `${base}${index}`;
  const existing = new Set(existingNames.map((name) => name.toLowerCase()));
  while (existing.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${base}${index}`;
  }
  return candidate;
}

function getSheetIdOrThrow(engine: HyperFormula, name: string): number {
  const sheetId = engine.getSheetId(name);
  if (sheetId == null) {
    throw new Error(`Sheet ${name} was not found in workbook engine.`);
  }
  return sheetId;
}

function createPivotSourceRows(data: string[][]) {
  const headerRow = (data.find((row) => row.some((cell) => String(cell || "").trim() !== "")) || []).map((cell, index) => {
    const label = String(cell || "").trim();
    return label || colLabel(index);
  });
  const rows = data
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const record: Record<string, string> = {};
      headerRow.forEach((header, index) => {
        record[header] = String(row[index] ?? "");
      });
      return record;
    });
  return { headers: headerRow, rows };
}

function aggregatePivot(values: number[], aggregation: PivotConfig["aggregation"]) {
  if (aggregation === "count") return values.length;
  if (!values.length) return 0;
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "max") return Math.max(...values);
  return Math.min(...values);
}

function summarizeSelection(data: string[][], bounds: SelectionBounds | null): SelectionSummary {
  if (!bounds) {
    return { average: null, count: 0, max: null, min: null, numericCount: 0, sum: null };
  }
  const numericValues: number[] = [];
  let count = 0;
  for (let row = bounds.r1; row <= bounds.r2; row += 1) {
    for (let col = bounds.c1; col <= bounds.c2; col += 1) {
      const raw = data[row]?.[col];
      if (raw == null || String(raw).trim() === "") continue;
      count += 1;
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) numericValues.push(numeric);
    }
  }
  if (!numericValues.length) {
    return { average: null, count, max: null, min: null, numericCount: 0, sum: null };
  }
  const sum = numericValues.reduce((total, value) => total + value, 0);
  return {
    average: sum / numericValues.length,
    count,
    max: Math.max(...numericValues),
    min: Math.min(...numericValues),
    numericCount: numericValues.length,
    sum,
  };
}

function RibbonIcon({ name }: { name: RibbonIconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const size = 16;
  switch (name) {
    case "undo":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M9 7H4v5" /><path {...common} d="M20 17a7 7 0 0 0-7-7H4" /></svg>;
    case "redo":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M15 7h5v5" /><path {...common} d="M4 17a7 7 0 0 1 7-7h9" /></svg>;
    case "save":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M5 4h11l3 3v13H5z" /><path {...common} d="M8 4v6h8V4" /><path {...common} d="M8 18h8" /></svg>;
    case "merge":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M4 6h6v4H4zM14 6h6v4h-6zM4 14h6v4H4zM14 14h6v4h-6z" /><path {...common} d="M10 12h4" /></svg>;
    case "unmerge":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M4 6h6v4H4zM14 6h6v4h-6zM4 14h6v4H4zM14 14h6v4h-6z" /><path {...common} d="M9 12h6" /><path {...common} d="m11 10-2 2 2 2M13 10l2 2-2 2" /></svg>;
    case "paste":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M9 4h6v3H9z" /><path {...common} d="M7 7h10v13H7z" /><path {...common} d="M9 11h6M9 15h4" /></svg>;
    case "copy":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M9 9h10v11H9z" /><path {...common} d="M5 15H4V4h11v1" /></svg>;
    case "cut":
      return <svg viewBox="0 0 24 24" width={size} height={size}><circle {...common} cx="6" cy="18" r="2.5" /><circle {...common} cx="18" cy="18" r="2.5" /><path {...common} d="M8 16 16 8M12 12l4 4M8 8l4 4" /></svg>;
    case "format-painter":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M4 7h12v4H4z" /><path {...common} d="M10 11v8" /><path {...common} d="M8 19h4" /></svg>;
    case "align-left":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M5 6h14M5 10h9M5 14h14M5 18h9" /></svg>;
    case "align-center":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M5 6h14M8 10h8M5 14h14M8 18h8" /></svg>;
    case "align-right":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M5 6h14M10 10h9M5 14h14M10 18h9" /></svg>;
    case "align-top":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M5 5h14" /><rect {...common} x="8" y="8" width="8" height="10" /></svg>;
    case "align-middle":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M5 12h14" /><rect {...common} x="8" y="7" width="8" height="10" /></svg>;
    case "align-bottom":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M5 19h14" /><rect {...common} x="8" y="6" width="8" height="10" /></svg>;
    case "sort-asc":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M7 17V7" /><path {...common} d="m4 10 3-3 3 3" /><path {...common} d="M13 17h7M13 12h5M13 7h3" /></svg>;
    case "sort-desc":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M7 7v10" /><path {...common} d="m4 14 3 3 3-3" /><path {...common} d="M13 17h3M13 12h5M13 7h7" /></svg>;
    case "table":
      return <svg viewBox="0 0 24 24" width={size} height={size}><rect {...common} x="4" y="6" width="16" height="12" /><path {...common} d="M4 10h16M9 6v12M15 6v12" /></svg>;
    case "styles":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M6 18h12" /><path {...common} d="m8 6 4 10 4-10" /><path {...common} d="M10 12h4" /></svg>;
    case "sum":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M16 5H8l5 7-5 7h8" /></svg>;
    case "filter":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M4 6h16l-6 7v5l-4 2v-7z" /></svg>;
    case "find":
      return <svg viewBox="0 0 24 24" width={size} height={size}><circle {...common} cx="11" cy="11" r="6" /><path {...common} d="m20 20-4.2-4.2" /></svg>;
    case "font-up":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="m6 18 6-12 6 12" /><path {...common} d="M9 13h6" /><path {...common} d="M18 8V4" /><path {...common} d="m16 6 2-2 2 2" /></svg>;
    case "font-down":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="m6 18 6-12 6 12" /><path {...common} d="M9 13h6" /><path {...common} d="M18 4v4" /><path {...common} d="m16 6 2 2 2-2" /></svg>;
    case "freeze-row":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M4 6h16M4 10h16M4 14h16M4 18h16" /><path {...common} d="M4 6h16" /></svg>;
    case "freeze-col":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M6 4v16M10 4v16M14 4v16M18 4v16" /><path {...common} d="M6 4v16" /></svg>;
    case "border":
      return <svg viewBox="0 0 24 24" width={size} height={size}><rect {...common} x="4" y="4" width="16" height="16" /><path {...common} d="M12 4v16M4 12h16" /></svg>;
    case "fill":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="m7 11 5-5 5 5" /><path {...common} d="M7 11h10" /><path {...common} d="M5 18h14" /></svg>;
    case "font-color":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="m7 18 5-12 5 12" /><path {...common} d="M9 14h6" /><path {...common} d="M5 20h14" /></svg>;
    case "wrap":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M4 7h11a4 4 0 1 1 0 8H9" /><path {...common} d="m9 15-3 3 3 3" /><path {...common} d="M4 11h8M4 19h5" /></svg>;
    case "pivot":
      return <svg viewBox="0 0 24 24" width={size} height={size}><path {...common} d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" /></svg>;
    case "bold":
      return <span className="ribbon-letter">B</span>;
    case "italic":
      return <span className="ribbon-letter ribbon-letter-italic">I</span>;
    case "underline":
      return <span className="ribbon-letter ribbon-letter-underline">U</span>;
    default:
      return <span className="ribbon-letter">A</span>;
  }
}

function TopbarIcon({ kind }: { kind: "cancel" | "reset" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "cancel") {
    return <svg viewBox="0 0 24 24" width={16} height={16}><path {...common} d="M18 6 6 18M6 6l12 12" /></svg>;
  }
  return <svg viewBox="0 0 24 24" width={16} height={16}><path {...common} d="M3 12a9 9 0 1 0 3-6.7" /><path {...common} d="M3 4v5h5" /></svg>;
}

function RibbonButton({
  active = false,
  children,
  disabled = false,
  onClick,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className={`ribbon-btn ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

function RibbonSection({
  children,
  title,
  wide = false,
}: {
  children: React.ReactNode;
  title: string;
  wide?: boolean;
}) {
  return (
    <div className={`ribbon-section ${wide ? "wide" : ""}`}>
      <div className="ribbon-section-tools">{children}</div>
      <span className="ribbon-section-title">{title}</span>
    </div>
  );
}

function RibbonGhostTool({
  disabled = true,
  icon,
  label,
  layout = "stack",
  onClick,
  title,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  layout?: "inline" | "stack";
  onClick?: () => void;
  title: string;
}) {
  return (
    <button type="button" className={`ribbon-ghost-tool ${layout === "inline" ? "inline" : ""}`} disabled={disabled} onClick={onClick} title={title} aria-label={title}>
      <span className="ribbon-ghost-icon">{icon}</span>
      <span className="ribbon-ghost-label">{label}</span>
    </button>
  );
}

function RibbonGlyph({ children }: { children: React.ReactNode }) {
  return <span className="ribbon-glyph">{children}</span>;
}

function getRibbonToolIcon(tool: string) {
  const key = tool.toLowerCase();
  if (key.includes("autosum")) return <RibbonIcon name="sum" />;
  if (key.includes("pivot")) return <RibbonIcon name="pivot" />;
  if (key.includes("table")) return <RibbonIcon name="table" />;
  if (key.includes("style")) return <RibbonIcon name="styles" />;
  if (key.includes("sort")) return <RibbonIcon name="sort-asc" />;
  if (key.includes("filter")) return <RibbonIcon name="filter" />;
  if (key.includes("find")) return <RibbonIcon name="find" />;
  if (key.includes("formula") || key.includes("function")) return <RibbonGlyph>fx</RibbonGlyph>;
  if (key.includes("comment") || key.includes("note")) return <RibbonGlyph>+</RibbonGlyph>;
  if (key.includes("protect")) return <RibbonGlyph>Lock</RibbonGlyph>;
  if (key.includes("zoom")) return <RibbonGlyph>100</RibbonGlyph>;
  if (key.includes("picture")) return <RibbonGlyph>Pic</RibbonGlyph>;
  if (key.includes("shape")) return <RibbonGlyph>Shp</RibbonGlyph>;
  if (key.includes("chart")) return <RibbonGlyph>Ch</RibbonGlyph>;
  if (key.includes("sparkline")) return <RibbonGlyph>Sp</RibbonGlyph>;
  if (key.includes("text")) return <RibbonGlyph>Tx</RibbonGlyph>;
  if (key.includes("spell")) return <RibbonGlyph>ABC</RibbonGlyph>;
  if (key.includes("group")) return <RibbonGlyph>Grp</RibbonGlyph>;
  if (key.includes("ungroup")) return <RibbonGlyph>Un</RibbonGlyph>;
  if (key.includes("data validation")) return <RibbonGlyph>DV</RibbonGlyph>;
  if (key.includes("duplicate")) return <RibbonGlyph>Dup</RibbonGlyph>;
  if (key.includes("page layout")) return <RibbonGlyph>Pg</RibbonGlyph>;
  if (key.includes("page break")) return <RibbonGlyph>Brk</RibbonGlyph>;
  if (key.includes("orientation")) return <RibbonGlyph>Ori</RibbonGlyph>;
  if (key.includes("margins")) return <RibbonGlyph>Mar</RibbonGlyph>;
  if (key.includes("size")) return <RibbonGlyph>Sz</RibbonGlyph>;
  if (key.includes("gridlines")) return <RibbonGlyph>Grid</RibbonGlyph>;
  if (key.includes("headings")) return <RibbonGlyph>Hd</RibbonGlyph>;
  return <RibbonGlyph>{tool.slice(0, Math.min(tool.length, 3))}</RibbonGlyph>;
}

function splitIntoRows(tools: string[], size = 3) {
  const rows: string[][] = [];
  for (let index = 0; index < tools.length; index += size) {
    rows.push(tools.slice(index, index + size));
  }
  return rows;
}

function getFontFamilyToken(family: string) {
  return `excel-font-family-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function readSelectionUiFromClasses(tokens: string[]): SelectionUiState {
  const fontToken = tokens.find((token) => token.startsWith("excel-font-family-"));
  const sizeToken = tokens.find((token) => token.startsWith("excel-font-") && !token.startsWith("excel-font-family-"));
  const fillToken = tokens.find((token) => token.startsWith("excel-fill-"));
  const textToken = tokens.find((token) => token.startsWith("excel-text-"));
  const alignToken = tokens.find((token) => token.startsWith("excel-align-"));
  const verticalAlignToken = tokens.find((token) => token.startsWith("excel-v-align-"));
  return {
    bold: tokens.includes("excel-bold"),
    italic: tokens.includes("excel-italic"),
    underline: tokens.includes("excel-underline"),
    border: tokens.includes("excel-border"),
    wrap: tokens.includes("excel-wrap"),
    align: alignToken === "excel-align-left" ? "left" : alignToken === "excel-align-center" ? "center" : alignToken === "excel-align-right" ? "right" : null,
    verticalAlign: verticalAlignToken === "excel-v-align-top" ? "top" : verticalAlignToken === "excel-v-align-middle" ? "middle" : verticalAlignToken === "excel-v-align-bottom" ? "bottom" : null,
    fontFamily: fontToken
      ? fontToken.replace("excel-font-family-", "").split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
      : "Aptos",
    fontSize: sizeToken ? sizeToken.replace("excel-font-", "") : "11",
    fillColor: fillToken ? fillToken.replace("excel-fill-", "") : null,
    textColor: textToken ? textToken.replace("excel-text-", "") : null,
  };
}

class ExcelErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Excel workbook crashed", error);
    if (typeof window !== "undefined") {
      (window as Window & { __excelLastError?: { message: string; stack?: string } }).__excelLastError =
        error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="excel-crash-panel">
          <strong>Workbook refresh needed</strong>
          <span>The sheet hit an unexpected error while updating. Refresh the page to continue.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function buildWorkbookSeed(initialSheet: SpreadsheetMap, lockedCells: string[]) {
  const size = computeGridSize(initialSheet);
  const assessmentData = mapToData(initialSheet, size.rows, size.cols);
  const scratchData = createBlankData(INITIAL_ROWS, INITIAL_COLS);
  const engine = HyperFormula.buildFromSheets(
    {
      Assessment: assessmentData,
      Scratch: scratchData,
    },
    { licenseKey: "internal-use-in-handsontable" },
  );
  const sheets: WorkbookSheet[] = [
    {
      engineSheetId: getSheetIdOrThrow(engine, "Assessment"),
      id: "sheet-assessment",
      lockedCells,
      name: "Assessment",
    },
    {
      engineSheetId: getSheetIdOrThrow(engine, "Scratch"),
      id: "sheet-scratch",
      lockedCells: [],
      name: "Scratch",
    },
  ];
  return { engine, sheets, activeSheetId: sheets[0].id };
}

export function ExcelSimulator({
  title = "Excel Assessment Workspace",
  description = "Excel-like workbook with formulas, multiple sheets, formatting, and review-safe autosave.",
  initialSheet = DEFAULT_SHEET,
  lockedCells = DEFAULT_LOCKED,
  readOnly = false,
  candidateMode = false,
  embedded = false,
  onSubmit,
  onAutosave,
  showTopbarActions = true,
}: ExcelSimulatorProps) {
  const normalizedLocked = useMemo(() => normalizeCells(lockedCells), [lockedCells]);
  const effectiveLockedCells = useMemo(() => (candidateMode ? normalizedLocked : []), [candidateMode, normalizedLocked]);
  const seed = useMemo(() => buildWorkbookSeed(initialSheet, effectiveLockedCells), [effectiveLockedCells, initialSheet]);
  const engineRef = useRef(seed.engine);
  const hotRef = useRef<HotTableClass>(null);
  const gridShellRef = useRef<HTMLDivElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const cellFormulaInputRef = useRef<HTMLTextAreaElement | null>(null);
  const activityLogRef = useRef<ActivityLogEntry[]>([]);
  const [sheets, setSheets] = useState<WorkbookSheet[]>(seed.sheets);
  const [sheetSnapshots, setSheetSnapshots] = useState<Record<string, string[][]>>(() =>
    Object.fromEntries(
      seed.sheets.map((sheet) => [
        sheet.id,
        (seed.engine.getSheetSerialized(sheet.engineSheetId) as string[][]) || createBlankData(INITIAL_ROWS, INITIAL_COLS),
      ]),
    ),
  );
  const [activeSheetId, setActiveSheetId] = useState(seed.activeSheetId);
  const [sheetViewVersion, setSheetViewVersion] = useState(0);
  const [selectedCell, setSelectedCell] = useState("A1");
  const [formulaText, setFormulaText] = useState("");
  const [nameInput, setNameInput] = useState("A1");
  const [status, setStatus] = useState("Ready");
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTabName>("Home");
  const [fixedTopRows, setFixedTopRows] = useState(1);
  const [fixedLeftCols, setFixedLeftCols] = useState(1);
  const [fontFamily, setFontFamily] = useState("Aptos");
  const [fontSize, setFontSize] = useState("11");
  const [formatChoice, setFormatChoice] = useState("General");
  const [showFillPalette, setShowFillPalette] = useState(false);
  const [showTextPalette, setShowTextPalette] = useState(false);
  const [pivotOpen, setPivotOpen] = useState(false);
  const [formulaSuggestionMode, setFormulaSuggestionMode] = useState<"bar" | "cell" | null>(null);
  const [formulaSuggestionIndex, setFormulaSuggestionIndex] = useState(0);
  const [cellFormulaOverlay, setCellFormulaOverlay] = useState<FormulaSuggestionOverlay | null>(null);
  const [clipboardPayload, setClipboardPayload] = useState<ClipboardPayload | null>(null);
  const [formatPainterPayload, setFormatPainterPayload] = useState<CellFormatMeta[][] | null>(null);
  const [selectionUi, setSelectionUi] = useState<SelectionUiState>({
    align: null,
    border: false,
    bold: false,
    fillColor: null,
    fontFamily: "Aptos",
    fontSize: "11",
    italic: false,
    textColor: null,
    underline: false,
    verticalAlign: null,
    wrap: false,
  });
  const [selectionSummary, setSelectionSummary] = useState<SelectionSummary>({
    average: null,
    count: 0,
    max: null,
    min: null,
    numericCount: 0,
    sum: null,
  });
  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    aggregation: "sum",
    columnField: "",
    rowField: "",
    valueField: "",
  });

  useQuery({
    queryKey: ["excel-graph-status"],
    queryFn: async () => (await api.get("/tools/excel/graph/status")).data,
    retry: false,
    enabled: !embedded,
  });

  const hotInstance = () => hotRef.current?.hotInstance as any;
  const activeSheet = useMemo(() => sheets.find((sheet) => sheet.id === activeSheetId) || sheets[0], [activeSheetId, sheets]);
  const activeSheetData = useMemo(() => {
    if (!activeSheet) return createBlankData(INITIAL_ROWS, INITIAL_COLS);
    return sheetSnapshots[activeSheet.id] || createBlankData(INITIAL_ROWS, INITIAL_COLS);
  }, [activeSheet, sheetSnapshots]);
  const lockedSet = useMemo(() => new Set(activeSheet?.lockedCells || []), [activeSheet]);
  const formulaSearchToken = useMemo(() => getFormulaSearchToken(formulaText), [formulaText]);
  const formulaSuggestions = useMemo(() => {
    if (!formulaText.startsWith("=")) return [];
    if (!formulaSearchToken) return FORMULA_SUGGESTIONS.slice(0, 8);
    return FORMULA_SUGGESTIONS
      .filter((item) => item.name.startsWith(formulaSearchToken))
      .slice(0, 8);
  }, [formulaSearchToken, formulaText]);
  const showFormulaSuggestions = !readOnly && !lockedSet.has(selectedCell) && formulaSuggestions.length > 0;
  const showFormulaBarSuggestions = showFormulaSuggestions && formulaSuggestionMode === "bar";
  const showCellFormulaSuggestions = showFormulaSuggestions && formulaSuggestionMode === "cell" && !!cellFormulaOverlay;

  const appendLog = useCallback((entry: Omit<ActivityLogEntry, "timestamp">) => {
    activityLogRef.current = [
      ...activityLogRef.current.slice(-299),
      { ...entry, timestamp: new Date().toISOString() },
    ];
  }, []);

  const updateSheetView = useCallback(() => {
    setSheetViewVersion((value) => value + 1);
  }, []);

  const captureActiveSheetSnapshot = useCallback(() => {
    const hot = hotInstance();
    if (!hot || !activeSheet) return;
    const sourceData = hot.getSourceData();
    if (!Array.isArray(sourceData)) return;
    const next = sourceData.map((row: unknown) => (Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : []));
    setSheetSnapshots((prev) => ({ ...prev, [activeSheet.id]: next }));
  }, [activeSheet]);

  const switchSheet = useCallback((sheetId: string) => {
    captureActiveSheetSnapshot();
    setActiveSheetId(sheetId);
    setSheetViewVersion((value) => value + 1);
  }, [captureActiveSheetSnapshot]);

  const collectSubmission = useCallback((): ExcelAssessmentSubmission => {
    const finalSheet: SpreadsheetMap = {};
    const calculated: SpreadsheetMap = {};
    const formulas: SpreadsheetMap = {};
    const editableCells: string[] = [];
    const lockedCellsOutput: string[] = [];
    sheets.forEach((sheet) => {
      const serialized = engineRef.current.getSheetSerialized(sheet.engineSheetId) as unknown[][];
      Object.assign(finalSheet, dataToMap(serialized, sheet.name));
      const calculatedSheet = engineRef.current.getSheetValues(sheet.engineSheetId) as unknown[][];
      Object.assign(calculated, dataToMap(calculatedSheet, sheet.name));
      const formulaSheet = engineRef.current.getSheetFormulas(sheet.engineSheetId) as (string | undefined)[][];
      (formulaSheet || []).forEach((row, rowIndex) => {
        if (!Array.isArray(row)) return;
        row.forEach((value, colIndex) => {
          if (!value) return;
          formulas[`${sheet.name}!${refFor(rowIndex, colIndex)}`] = value;
        });
      });
      const usedBounds = collectUsedBounds(serialized || []);
      (serialized || []).forEach((row, rowIndex) => {
        if (!Array.isArray(row)) return;
        row.forEach((_value, colIndex) => {
          if (rowIndex > usedBounds.maxRow + 10 || colIndex > usedBounds.maxCol + 6) return;
          const ref = `${sheet.name}!${refFor(rowIndex, colIndex)}`;
          if ((sheet.lockedCells || []).includes(refFor(rowIndex, colIndex))) {
            lockedCellsOutput.push(ref);
          } else {
            editableCells.push(ref);
          }
        });
      });
    });
    return {
      final_sheet_json: finalSheet,
      formulas_json: formulas,
      calculated_values_json: calculated,
      activity_log: activityLogRef.current,
      editable_cells: editableCells,
      locked_cells: lockedCellsOutput,
      submitted_at: new Date().toISOString(),
    };
  }, [sheets]);

  const autosave = useCallback(() => {
    try {
      const submission = collectSubmission();
      const lightweightAutosave = {
        ...submission,
        activity_log: submission.activity_log.slice(-40),
        editable_cells: [],
        locked_cells: [],
      };
      window.localStorage.setItem("certora_excel_assessment_autosave", JSON.stringify(lightweightAutosave));
      onAutosave?.(lightweightAutosave);
      setStatus(`Autosaved ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Excel autosave failed", error);
      setStatus("Autosave paused");
    }
  }, [collectSubmission, onAutosave]);

  const getSelectionBounds = useCallback(() => buildSelectionBounds(hotInstance()?.getSelectedLast?.()), []);

  const updateSelectionDisplay = useCallback((row: number, col: number) => {
    const ref = refFor(row, col);
    setSelectedCell((previous) => (previous === ref ? previous : ref));
    setNameInput((previous) => (previous === ref ? previous : ref));
    const raw = hotInstance()?.getSourceDataAtCell?.(row, col);
    const nextFormula = raw == null ? "" : String(raw);
    setFormulaText((previous) => (previous === nextFormula ? previous : nextFormula));
    const meta = hotInstance()?.getCellMeta?.(row, col) as Record<string, unknown> | undefined;
    const nextUi = readSelectionUiFromClasses(parseClassTokens(meta?.excelClasses));
    setSelectionUi((previous) => JSON.stringify(previous) === JSON.stringify(nextUi) ? previous : nextUi);
    setFontFamily((previous) => (previous === nextUi.fontFamily ? previous : nextUi.fontFamily));
    setFontSize((previous) => (previous === nextUi.fontSize ? previous : nextUi.fontSize));
    setFormulaSuggestionIndex(0);
  }, []);

  const syncCellFormulaSuggestions = useCallback(() => {
    const hot = hotInstance();
    const activeEditor = hot?.getActiveEditor?.();
    const editorInput = activeEditor?.TEXTAREA as HTMLTextAreaElement | undefined;
    const shell = gridShellRef.current;

    if (!activeEditor?.isOpened?.() || !editorInput || !shell) {
      cellFormulaInputRef.current = null;
      setCellFormulaOverlay(null);
      setFormulaSuggestionMode((previous) => (previous === "cell" ? null : previous));
      return;
    }

    cellFormulaInputRef.current = editorInput;
    const nextValue = editorInput.value ?? "";
    setFormulaText((previous) => (previous === nextValue ? previous : nextValue));

    if (!nextValue.startsWith("=")) {
      setCellFormulaOverlay(null);
      setFormulaSuggestionMode((previous) => (previous === "cell" ? null : previous));
      return;
    }

    const editorRect = editorInput.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    setCellFormulaOverlay({
      left: Math.max(8, editorRect.left - shellRect.left),
      top: editorRect.bottom - shellRect.top + 4,
      width: Math.min(240, Math.max(180, editorRect.width + 28)),
    });
    setFormulaSuggestionMode("cell");
  }, []);

  const handleCellFormulaInput = useCallback(() => {
    syncCellFormulaSuggestions();
  }, [syncCellFormulaSuggestions]);

  const attachCellFormulaEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      const hot = hotInstance();
      const activeEditor = hot?.getActiveEditor?.();
      const editorInput = activeEditor?.TEXTAREA as HTMLTextAreaElement | undefined;
      if (!editorInput) return;
      if (cellFormulaInputRef.current && cellFormulaInputRef.current !== editorInput) {
        cellFormulaInputRef.current.removeEventListener("input", handleCellFormulaInput);
      }
      cellFormulaInputRef.current = editorInput;
      editorInput.removeEventListener("input", handleCellFormulaInput);
      editorInput.addEventListener("input", handleCellFormulaInput);
      syncCellFormulaSuggestions();
    });
  }, [handleCellFormulaInput, syncCellFormulaSuggestions]);

  const applyFormulaSuggestion = useCallback((name: string) => {
    const targetInput = formulaSuggestionMode === "cell" ? cellFormulaInputRef.current : formulaInputRef.current;
    const sourceValue = targetInput?.value ?? formulaText;
    const nextValue = sourceValue.replace(/([A-Z][A-Z0-9]*)$/i, name);
    const normalizedValue = nextValue.endsWith("(") ? nextValue : `${nextValue}(`;
    setFormulaText(normalizedValue);
    setFormulaSuggestionIndex(0);

    if (formulaSuggestionMode === "cell" && targetInput) {
      targetInput.value = normalizedValue;
      targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      targetInput.focus();
      const cursor = normalizedValue.length;
      targetInput.setSelectionRange(cursor, cursor);
      return;
    }

    window.requestAnimationFrame(() => {
      const input = formulaInputRef.current;
      if (!input) return;
      input.focus();
      const cursor = normalizedValue.length;
      input.setSelectionRange(cursor, cursor);
    });
  }, [formulaSuggestionMode, formulaText]);

  const updateSelectionSummary = useCallback(() => {
    const bounds = getSelectionBounds();
    const applySummary = (nextSummary: SelectionSummary) => {
      setSelectionSummary((previous) => (
        previous.count === nextSummary.count &&
        previous.numericCount === nextSummary.numericCount &&
        previous.sum === nextSummary.sum &&
        previous.average === nextSummary.average &&
        previous.min === nextSummary.min &&
        previous.max === nextSummary.max
      ) ? previous : nextSummary);
    };
    const sourceData = hotInstance()?.getSourceData?.();
    if (Array.isArray(sourceData)) {
      const normalized = sourceData.map((row: unknown) => (Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : []));
      applySummary(summarizeSelection(normalized, bounds));
      return;
    }
    applySummary(summarizeSelection(activeSheetData, bounds));
  }, [activeSheetData, getSelectionBounds]);

  const readCellFormatMeta = useCallback((row: number, col: number): CellFormatMeta => {
    const hot = hotInstance();
    const meta = (hot?.getCellMeta(row, col) || {}) as Record<string, unknown>;
    return {
      excelClasses: typeof meta.excelClasses === "string" ? meta.excelClasses : "",
      type: typeof meta.type === "string" ? meta.type : undefined,
      dateFormat: typeof meta.dateFormat === "string" ? meta.dateFormat : undefined,
      correctFormat: typeof meta.correctFormat === "boolean" ? meta.correctFormat : undefined,
      numericFormat: meta.numericFormat && typeof meta.numericFormat === "object"
        ? JSON.parse(JSON.stringify(meta.numericFormat)) as { pattern: string }
        : undefined,
    };
  }, []);

  const writeCellFormatMeta = useCallback((row: number, col: number, meta: CellFormatMeta) => {
    const hot = hotInstance();
    if (!hot || lockedSet.has(refFor(row, col))) return;
    hot.setCellMeta(row, col, "excelClasses", meta.excelClasses || "");
    if (meta.type) hot.setCellMeta(row, col, "type", meta.type);
    else hot.removeCellMeta(row, col, "type");
    if (meta.numericFormat) hot.setCellMeta(row, col, "numericFormat", meta.numericFormat);
    else hot.removeCellMeta(row, col, "numericFormat");
    if (meta.dateFormat) hot.setCellMeta(row, col, "dateFormat", meta.dateFormat);
    else hot.removeCellMeta(row, col, "dateFormat");
    if (typeof meta.correctFormat === "boolean") hot.setCellMeta(row, col, "correctFormat", meta.correctFormat);
    else hot.removeCellMeta(row, col, "correctFormat");
  }, [lockedSet]);

  const collectSelectionClipboard = useCallback((): ClipboardPayload | null => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds) return null;
    const data: string[][] = [];
    const meta: CellFormatMeta[][] = [];
    for (let row = bounds.r1; row <= bounds.r2; row += 1) {
      const rowData: string[] = [];
      const rowMeta: CellFormatMeta[] = [];
      for (let col = bounds.c1; col <= bounds.c2; col += 1) {
        const value = hot.getSourceDataAtCell(row, col);
        rowData.push(value == null ? "" : String(value));
        rowMeta.push(readCellFormatMeta(row, col));
      }
      data.push(rowData);
      meta.push(rowMeta);
    }
    return { data, meta };
  }, [getSelectionBounds, readCellFormatMeta]);

  const writeClipboardText = useCallback(async (data: string[][]) => {
    const plainText = data.map((row) => row.join("\t")).join("\n");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(plainText);
    } catch {
      // Browser clipboard permissions are inconsistent on local tooling; the in-app buffer still works.
    }
  }, []);

  const triggerUndo = useCallback(() => {
    const hot = hotInstance();
    const plugin = hot?.getPlugin?.("undoRedo");
    if (!plugin?.isUndoAvailable?.()) return;
    plugin.undo();
    appendLog({ type: "undo", cell: selectedCell });
    window.setTimeout(() => {
      captureActiveSheetSnapshot();
      updateSelectionSummary();
    }, 0);
  }, [appendLog, captureActiveSheetSnapshot, selectedCell, updateSelectionSummary]);

  const triggerRedo = useCallback(() => {
    const hot = hotInstance();
    const plugin = hot?.getPlugin?.("undoRedo");
    if (!plugin?.isRedoAvailable?.()) return;
    plugin.redo();
    appendLog({ type: "redo", cell: selectedCell });
    window.setTimeout(() => {
      captureActiveSheetSnapshot();
      updateSelectionSummary();
    }, 0);
  }, [appendLog, captureActiveSheetSnapshot, selectedCell, updateSelectionSummary]);

  const handleCopy = useCallback(async () => {
    const payload = collectSelectionClipboard();
    if (!payload) return;
    setClipboardPayload(payload);
    await writeClipboardText(payload.data);
    appendLog({ type: "copy", cell: selectedCell });
    setStatus("Copied");
  }, [appendLog, collectSelectionClipboard, selectedCell, writeClipboardText]);

  const handleCut = useCallback(async () => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    const payload = collectSelectionClipboard();
    if (!hot || !bounds || !payload || readOnly) return;
    setClipboardPayload(payload);
    await writeClipboardText(payload.data);
    const blank = payload.data.map((row) => row.map(() => ""));
    hot.populateFromArray(bounds.r1, bounds.c1, blank, undefined, undefined, "cut");
    hot.render();
    captureActiveSheetSnapshot();
    appendLog({ type: "cut", cell: selectedCell });
    setStatus("Cut");
  }, [appendLog, captureActiveSheetSnapshot, collectSelectionClipboard, getSelectionBounds, readOnly, selectedCell, writeClipboardText]);

  const handlePaste = useCallback(async () => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds || readOnly) return;
    let payload = clipboardPayload;
    if (!payload) {
      try {
        const text = await navigator.clipboard?.readText?.();
        if (text) {
          payload = {
            data: text.split(/\r?\n/).filter((row) => row.length > 0).map((row) => row.split("\t")),
            meta: [],
          };
        }
      } catch {
        // Best-effort fallback only.
      }
    }
    if (!payload) {
      setStatus("Nothing to paste");
      return;
    }
    hot.populateFromArray(bounds.r1, bounds.c1, payload.data, undefined, undefined, "toolbar-paste");
    payload.meta.forEach((metaRow, rowIndex) => {
      metaRow.forEach((meta, colIndex) => {
        writeCellFormatMeta(bounds.r1 + rowIndex, bounds.c1 + colIndex, meta);
      });
    });
    hot.render();
    captureActiveSheetSnapshot();
    updateSelectionSummary();
    appendLog({ type: "paste", cell: selectedCell });
    setStatus("Pasted");
  }, [appendLog, captureActiveSheetSnapshot, clipboardPayload, getSelectionBounds, readOnly, selectedCell, updateSelectionSummary, writeCellFormatMeta]);

  const handleFormatPainter = useCallback(() => {
    if (formatPainterPayload) {
      const bounds = getSelectionBounds();
      const hot = hotInstance();
      if (!hot || !bounds) return;
      formatPainterPayload.forEach((metaRow, rowIndex) => {
        metaRow.forEach((meta, colIndex) => {
          writeCellFormatMeta(bounds.r1 + rowIndex, bounds.c1 + colIndex, meta);
        });
      });
      hot.render();
      captureActiveSheetSnapshot();
      updateSelectionSummary();
      setFormatPainterPayload(null);
      appendLog({ type: "format_painter_apply", cell: selectedCell });
      setStatus("Format applied");
      return;
    }
    const payload = collectSelectionClipboard();
    if (!payload) return;
    setFormatPainterPayload(payload.meta);
    appendLog({ type: "format_painter_pick", cell: selectedCell });
    setStatus("Select a target range and click Painter again");
  }, [appendLog, captureActiveSheetSnapshot, collectSelectionClipboard, formatPainterPayload, getSelectionBounds, selectedCell, updateSelectionSummary, writeCellFormatMeta]);

  const updateMetaForSelection = useCallback((
    updater: (row: number, col: number) => void,
    label: string,
  ) => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds) return;
    for (let row = bounds.r1; row <= bounds.r2; row += 1) {
      for (let col = bounds.c1; col <= bounds.c2; col += 1) {
        if (lockedSet.has(refFor(row, col))) continue;
        updater(row, col);
      }
    }
    hot.render();
    appendLog({ type: "format", cell: selectedCell, to: label });
    setStatus(`${label} applied`);
    updateSelectionSummary();
  }, [appendLog, getSelectionBounds, lockedSet, selectedCell, updateSelectionSummary]);

  const toggleClassFormat = useCallback((token: string, label: string) => {
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      const meta = hot.getCellMeta(row, col) as Record<string, unknown>;
      const current = new Set(parseClassTokens(meta.excelClasses));
      if (current.has(token)) current.delete(token);
      else current.add(token);
      hot.setCellMeta(row, col, "excelClasses", Array.from(current).join(" "));
    }, label);
  }, [updateMetaForSelection]);

  const setExclusiveClassFormat = useCallback((prefix: string, token: string, label: string) => {
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      const meta = hot.getCellMeta(row, col) as Record<string, unknown>;
      const current = parseClassTokens(meta.excelClasses).filter((value) => !value.startsWith(prefix));
      current.push(token);
      hot.setCellMeta(row, col, "excelClasses", Array.from(new Set(current)).join(" "));
    }, label);
  }, [updateMetaForSelection]);

  const applyMetaPatch = useCallback((patch: Record<string, unknown>, label: string) => {
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      Object.entries(patch).forEach(([key, value]) => {
        hot.setCellMeta(row, col, key, value);
      });
    }, label);
  }, [updateMetaForSelection]);

  const applyFontSize = useCallback((value: string) => {
    setFontSize(value);
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      const meta = hot.getCellMeta(row, col) as Record<string, unknown>;
      const current = parseClassTokens(meta.excelClasses).filter((token) => !token.startsWith("excel-font-"));
      current.push(`excel-font-${value}`);
      hot.setCellMeta(row, col, "excelClasses", Array.from(new Set(current)).join(" "));
    }, `font ${value}px`);
  }, [updateMetaForSelection]);

  const applyFontFamily = useCallback((family: string) => {
    setFontFamily(family);
    const token = getFontFamilyToken(family);
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      const meta = hot.getCellMeta(row, col) as Record<string, unknown>;
      const current = parseClassTokens(meta.excelClasses).filter((item) => !item.startsWith("excel-font-family-"));
      current.push(token);
      hot.setCellMeta(row, col, "excelClasses", Array.from(new Set(current)).join(" "));
    }, `${family} font`);
  }, [updateMetaForSelection]);

  const nudgeFontSize = useCallback((direction: 1 | -1) => {
    const sizes = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36"];
    const currentIndex = Math.max(0, sizes.indexOf(fontSize));
    const nextIndex = Math.min(sizes.length - 1, Math.max(0, currentIndex + direction));
    applyFontSize(sizes[nextIndex]);
  }, [applyFontSize, fontSize]);

  const adjustDecimalPlaces = useCallback((direction: 1 | -1) => {
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      const meta = hot.getCellMeta(row, col) as Record<string, unknown>;
      const currentPattern = typeof (meta.numericFormat as { pattern?: string } | undefined)?.pattern === "string"
        ? ((meta.numericFormat as { pattern: string }).pattern)
        : "0.00";
      const decimalMatch = currentPattern.match(/\.([0#]+)/);
      const currentDecimals = decimalMatch ? decimalMatch[1].length : 0;
      const nextDecimals = Math.max(0, Math.min(6, currentDecimals + direction));
      const cleaned = currentPattern.replace(/\.[0#]+/, "");
      const nextPattern = nextDecimals > 0 ? `${cleaned}.${"0".repeat(nextDecimals)}` : cleaned;
      hot.setCellMeta(row, col, "type", "numeric");
      hot.setCellMeta(row, col, "numericFormat", { pattern: nextPattern });
    }, direction > 0 ? "increase decimals" : "decrease decimals");
  }, [updateMetaForSelection]);

  const clearFormatting = useCallback(() => {
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      hot.removeCellMeta(row, col, "excelClasses");
      hot.removeCellMeta(row, col, "type");
      hot.removeCellMeta(row, col, "numericFormat");
      hot.removeCellMeta(row, col, "dateFormat");
      hot.removeCellMeta(row, col, "correctFormat");
    }, "format clear");
  }, [updateMetaForSelection]);

  const applyFormatChoice = useCallback((label: string) => {
    setFormatChoice(label);
    const selected = NUMBER_FORMAT_OPTIONS.find((option) => option.label === label);
    if (!selected) return;
    if (!Object.keys(selected.patch).length) {
      clearFormatting();
      return;
    }
    applyMetaPatch(selected.patch, label);
  }, [applyMetaPatch, clearFormatting]);

  const mergeSelection = useCallback((mode: "merge" | "unmerge") => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds) return;
    const plugin = hot.getPlugin("mergeCells");
    if (mode === "merge") {
      plugin.merge(bounds.r1, bounds.c1, bounds.r2, bounds.c2);
      setStatus("Cells merged");
    } else {
      plugin.unmerge(bounds.r1, bounds.c1, bounds.r2, bounds.c2);
      setStatus("Cells unmerged");
    }
    hot.render();
    appendLog({ type: mode, cell: selectedCell });
    updateSelectionSummary();
  }, [appendLog, getSelectionBounds, selectedCell, updateSelectionSummary]);

  const alterGrid = useCallback((kind: "insert_col_end" | "insert_row_below") => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds) return;
    hot.alter(kind, kind === "insert_row_below" ? bounds.r2 : bounds.c2, 1);
    appendLog({ type: kind, cell: selectedCell });
    setStatus(kind === "insert_row_below" ? "Row inserted" : "Column inserted");
    window.setTimeout(() => autosave(), 0);
    window.setTimeout(() => updateSelectionSummary(), 0);
  }, [appendLog, autosave, getSelectionBounds, selectedCell, updateSelectionSummary]);

  const sortSelection = useCallback((sortOrder: "asc" | "desc") => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds) return;
    hot.getPlugin("columnSorting").sort({ column: bounds.c1, sortOrder });
    appendLog({ type: `sort_${sortOrder}`, cell: selectedCell });
    setStatus(sortOrder === "asc" ? "Sorted A to Z" : "Sorted Z to A");
    window.setTimeout(() => updateSelectionSummary(), 0);
  }, [appendLog, getSelectionBounds, selectedCell, updateSelectionSummary]);

  const applyAutoSum = useCallback(() => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds || readOnly) return;
    const formulaRange = `${refFor(bounds.r1, bounds.c1)}:${refFor(bounds.r2, bounds.c2)}`;
    const targetRow = bounds.r1 === bounds.r2 ? bounds.r1 : bounds.r2 + 1;
    const targetCol = bounds.r1 === bounds.r2 ? bounds.c2 + 1 : bounds.c1;
    if (lockedSet.has(refFor(targetRow, targetCol))) return;
    hot.setDataAtCell(targetRow, targetCol, `=SUM(${formulaRange})`, "autosum");
    hot.selectCell(targetRow, targetCol, targetRow, targetCol, true, true);
    appendLog({ type: "autosum", cell: refFor(targetRow, targetCol) });
    setStatus("AutoSum inserted");
  }, [appendLog, getSelectionBounds, lockedSet, readOnly]);

  const runFind = useCallback(() => {
    const hot = hotInstance();
    if (!hot) return;
    const query = window.prompt("Find value");
    if (!query) return;
    const sourceData = hot.getSourceData() as unknown[][];
    for (let row = 0; row < sourceData.length; row += 1) {
      const cells = Array.isArray(sourceData[row]) ? sourceData[row] : [];
      for (let col = 0; col < cells.length; col += 1) {
        if (String(cells[col] ?? "").toLowerCase().includes(query.toLowerCase())) {
          hot.selectCell(row, col, row, col, true, true);
          hot.scrollViewportTo(row, col, true, true);
          updateSelectionDisplay(row, col);
          setStatus(`Found "${query}"`);
          return;
        }
      }
    }
    setStatus(`No match for "${query}"`);
  }, [updateSelectionDisplay]);

  const applyFilter = useCallback(() => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds) return;
    const term = window.prompt("Filter selected column by text. Leave blank to clear filters.", "");
    const filtersPlugin = hot.getPlugin("filters");
    filtersPlugin.clearConditions(bounds.c1);
    if (term) {
      filtersPlugin.addCondition(bounds.c1, "contains", [term]);
    }
    filtersPlugin.filter();
    appendLog({ type: "filter", cell: selectedCell, to: term || "clear" });
    setStatus(term ? `Filtered by "${term}"` : "Filter cleared");
  }, [appendLog, getSelectionBounds, selectedCell]);

  const applyTableFormat = useCallback(() => {
    const hot = hotInstance();
    const bounds = getSelectionBounds();
    if (!hot || !bounds) return;
    for (let row = bounds.r1; row <= bounds.r2; row += 1) {
      for (let col = bounds.c1; col <= bounds.c2; col += 1) {
        if (lockedSet.has(refFor(row, col))) continue;
        const meta = hot.getCellMeta(row, col) as Record<string, unknown>;
        const current = new Set(parseClassTokens(meta.excelClasses));
        current.add("excel-border");
        if (row === bounds.r1) {
          current.add("excel-bold");
          current.add("excel-fill-107c41");
          current.add("excel-text-f8fafc");
        } else if ((row - bounds.r1) % 2 === 1) {
          current.add("excel-fill-f8fafc");
        }
        hot.setCellMeta(row, col, "excelClasses", Array.from(current).join(" "));
      }
    }
    hot.render();
    appendLog({ type: "format_table", cell: selectedCell });
    setStatus("Table formatting applied");
  }, [appendLog, getSelectionBounds, lockedSet, selectedCell]);

  const applyCellStylePreset = useCallback(() => {
    const preset = window.prompt("Cell style: good, neutral, bad, heading, input, output", "heading")?.trim().toLowerCase();
    if (!preset) return;
    const styleMap: Record<string, string[]> = {
      good: ["excel-fill-green", "excel-text-107c41", "excel-border"],
      neutral: ["excel-fill-f8fafc", "excel-border"],
      bad: ["excel-fill-dc2626", "excel-text-f8fafc", "excel-border"],
      heading: ["excel-bold", "excel-fill-1f2937", "excel-text-f8fafc", "excel-border"],
      input: ["excel-fill-yellow", "excel-border"],
      output: ["excel-fill-blue", "excel-border", "excel-bold"],
    };
    const tokens = styleMap[preset];
    if (!tokens) {
      setStatus("Unknown style");
      return;
    }
    updateMetaForSelection((row, col) => {
      const hot = hotInstance();
      const meta = hot.getCellMeta(row, col) as Record<string, unknown>;
      const current = new Set(parseClassTokens(meta.excelClasses));
      tokens.forEach((token) => current.add(token));
      hot.setCellMeta(row, col, "excelClasses", Array.from(current).join(" "));
    }, `${preset} style`);
  }, [updateMetaForSelection]);

  const jumpToCell = useCallback(() => {
    const hot = hotInstance();
    const pos = parseRef(nameInput);
    if (!hot || !pos) {
      setStatus("Invalid cell reference");
      return;
    }
    hot.selectCell(pos.row, pos.col, pos.row, pos.col, true, true);
    hot.scrollViewportTo(pos.row, pos.col, true, true);
    updateSelectionDisplay(pos.row, pos.col);
  }, [nameInput, updateSelectionDisplay]);

  const commitFormulaBar = useCallback(() => {
    const hot = hotInstance();
    const pos = parseRef(selectedCell);
    if (!hot || !pos || lockedSet.has(selectedCell)) return;
    hot.setDataAtCell(pos.row, pos.col, formulaText, "formula-bar");
    setStatus("Formula updated");
  }, [formulaText, lockedSet, selectedCell]);

  const resetWorkbook = useCallback(() => {
    if (!window.confirm("Reset this workbook to its starting state? Unsaved changes will be removed.")) return;
    const nextSeed = buildWorkbookSeed(initialSheet, effectiveLockedCells);
    engineRef.current.destroy();
    engineRef.current = nextSeed.engine;
    setSheets(nextSeed.sheets);
    setSheetSnapshots(
      Object.fromEntries(
        nextSeed.sheets.map((sheet) => [
          sheet.id,
          (nextSeed.engine.getSheetSerialized(sheet.engineSheetId) as string[][]) || createBlankData(INITIAL_ROWS, INITIAL_COLS),
        ]),
      ),
    );
    setActiveSheetId(nextSeed.activeSheetId);
    setSheetViewVersion((value) => value + 1);
    setSelectedCell("A1");
    setNameInput("A1");
    setFormulaText("");
    activityLogRef.current = [];
    setStatus("Workbook reset");
  }, [effectiveLockedCells, initialSheet]);

  const cancelWorkbook = useCallback(() => {
    if (!window.confirm("Leave this workbook now? Any unsaved changes will be lost.")) return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign("/");
  }, []);

  const addSheet = useCallback(() => {
    const name = getUniqueSheetName(sheets.map((sheet) => sheet.name));
    const data = createBlankData(INITIAL_ROWS, INITIAL_COLS);
    engineRef.current.addSheet(name);
    const engineSheetId = getSheetIdOrThrow(engineRef.current, name);
    engineRef.current.setSheetContent(engineSheetId, data);
    const nextSheet: WorkbookSheet = {
      engineSheetId,
      id: `sheet-${Date.now()}`,
      lockedCells: [],
      name,
    };
    setSheets((prev) => [...prev, nextSheet]);
    setSheetSnapshots((prev) => ({ ...prev, [nextSheet.id]: data }));
    setActiveSheetId(nextSheet.id);
    setSheetViewVersion((value) => value + 1);
    appendLog({ type: "sheet_add", to: name });
    setStatus(`${name} added`);
  }, [appendLog, sheets]);

  const renameSheet = useCallback((sheetId: string) => {
    const target = sheets.find((sheet) => sheet.id === sheetId);
    if (!target) return;
    const nextName = window.prompt("Rename sheet", target.name)?.trim();
    if (!nextName || nextName === target.name) return;
    if (sheets.some((sheet) => sheet.id !== sheetId && sheet.name.toLowerCase() === nextName.toLowerCase())) {
      setStatus("Sheet name already exists");
      return;
    }
    engineRef.current.renameSheet(target.engineSheetId, nextName);
    setSheets((prev) => prev.map((sheet) => (sheet.id === sheetId ? { ...sheet, name: nextName } : sheet)));
    updateSheetView();
    appendLog({ type: "sheet_rename", from: target.name, to: nextName });
    setStatus(`Renamed to ${nextName}`);
  }, [appendLog, sheets, updateSheetView]);

  const removeSheet = useCallback((sheetId: string) => {
    if (sheets.length <= 1) return;
    const target = sheets.find((sheet) => sheet.id === sheetId);
    if (!target) return;
    engineRef.current.removeSheet(target.engineSheetId);
    const nextSheets = sheets.filter((sheet) => sheet.id !== sheetId);
    setSheets(nextSheets);
    setSheetSnapshots((prev) => {
      const copy = { ...prev };
      delete copy[sheetId];
      return copy;
    });
    if (activeSheetId === sheetId) {
      setActiveSheetId(nextSheets[0].id);
    }
    updateSheetView();
    appendLog({ type: "sheet_remove", from: target.name });
    setStatus(`${target.name} removed`);
  }, [activeSheetId, appendLog, sheets, updateSheetView]);

  const submit = async () => {
    const submission = collectSubmission();
    await onSubmit?.(submission);
    setStatus("Submitted");
  };

  const pivotSource = useMemo(() => createPivotSourceRows(activeSheetData), [activeSheetData]);

  const pivotResult = useMemo(() => {
    if (!pivotSource.headers.length) return null;
    const rowField = pivotConfig.rowField || pivotSource.headers[0] || "";
    const columnField = pivotConfig.columnField || pivotSource.headers[1] || "";
    const valueField = pivotConfig.valueField || pivotSource.headers[2] || pivotSource.headers[0] || "";
    const columnSet = new Set<string>();
    const grouped = new Map<string, Map<string, number[]>>();
    pivotSource.rows.forEach((row) => {
      const rowKey = row[rowField] || "(blank)";
      const columnKey = row[columnField] || "(blank)";
      const numericValue = Number(row[valueField] || 0);
      columnSet.add(columnKey);
      const rowMap = grouped.get(rowKey) || new Map<string, number[]>();
      const bucket = rowMap.get(columnKey) || [];
      bucket.push(Number.isFinite(numericValue) ? numericValue : 0);
      rowMap.set(columnKey, bucket);
      grouped.set(rowKey, rowMap);
    });
    const columns = Array.from(columnSet);
    const rows = Array.from(grouped.entries()).map(([rowKey, rowMap]) => ({
      key: rowKey,
      values: columns.map((column) => aggregatePivot(rowMap.get(column) || [], pivotConfig.aggregation)),
    }));
    return { columns, rowField, valueField, rows };
  }, [pivotConfig, pivotSource]);

  const renderFormulaSuggestionList = (compact = false) => (
    <div className={`formula-suggestions ${compact ? "compact" : ""}`} role="listbox" aria-label="Formula suggestions">
      {formulaSuggestions.map((item, index) => (
        <button
          key={item.name}
          type="button"
          className={`formula-suggestion-item ${index === formulaSuggestionIndex ? "active" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyFormulaSuggestion(item.name)}
        >
          <strong>{item.name}</strong>
          <span>{item.signature}</span>
          <small>{item.description}</small>
        </button>
      ))}
    </div>
  );
  const ribbonTabs: RibbonTabName[] = ["Home", "Insert", "Page Layout", "Formulas", "Data", "Review", "View"];
  const renderRibbonTabContent = () => {
    if (activeRibbonTab === "Home") {
      return (
        <>
          <RibbonSection title="Clipboard">
            <div className="ribbon-stack-large">
              <RibbonGhostTool icon={<RibbonIcon name="paste" />} label="Paste" title="Paste" disabled={readOnly} onClick={() => void handlePaste()} />
            </div>
            <div className="ribbon-clipboard-mini">
              <RibbonGhostTool icon={<RibbonIcon name="copy" />} label="Copy" title="Copy" layout="inline" disabled={false} onClick={() => void handleCopy()} />
              <RibbonGhostTool icon={<RibbonIcon name="cut" />} label="Cut" title="Cut" layout="inline" disabled={readOnly} onClick={() => void handleCut()} />
              <RibbonGhostTool icon={<RibbonIcon name="format-painter" />} label="Painter" title="Format Painter" layout="inline" disabled={false} onClick={handleFormatPainter} />
            </div>
          </RibbonSection>

          <RibbonSection title="Font" wide>
            <div className="ribbon-font-layout">
              <div className="ribbon-font-row ribbon-font-row-top">
                <select value={fontFamily} className="excel-select ribbon-font-family" onChange={(e) => applyFontFamily(e.target.value)} aria-label="Font family">
                  {["Aptos", "Calibri", "Arial", "Times New Roman", "Verdana", "Tahoma", "Cambria"].map((family) => (
                    <option key={family} value={family}>{family}</option>
                  ))}
                </select>
                <select value={fontSize} className="excel-select compact" onChange={(e) => applyFontSize(e.target.value)} disabled={readOnly} aria-label="Font size">
                  {["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36"].map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <RibbonButton title="Increase font size" onClick={() => nudgeFontSize(1)} disabled={readOnly}><RibbonIcon name="font-up" /></RibbonButton>
                <RibbonButton title="Decrease font size" onClick={() => nudgeFontSize(-1)} disabled={readOnly}><RibbonIcon name="font-down" /></RibbonButton>
              </div>
              <div className="ribbon-font-row ribbon-font-row-bottom">
                <button type="button" className={`ribbon-inline-icon ${selectionUi.bold ? "active" : ""}`} title="Bold" aria-label="Bold" onClick={() => toggleClassFormat("excel-bold", "bold")} disabled={readOnly}><RibbonIcon name="bold" /></button>
                <button type="button" className={`ribbon-inline-icon ${selectionUi.italic ? "active" : ""}`} title="Italic" aria-label="Italic" onClick={() => toggleClassFormat("excel-italic", "italic")} disabled={readOnly}><RibbonIcon name="italic" /></button>
                <button type="button" className={`ribbon-inline-icon ${selectionUi.underline ? "active" : ""}`} title="Underline" aria-label="Underline" onClick={() => toggleClassFormat("excel-underline", "underline")} disabled={readOnly}><RibbonIcon name="underline" /></button>
                <button type="button" className={`ribbon-inline-icon ${selectionUi.border ? "active" : ""}`} title="Borders" aria-label="Borders" onClick={() => toggleClassFormat("excel-border", "border")} disabled={readOnly}><RibbonIcon name="border" /></button>
                <div className="ribbon-pop-wrap ribbon-inline-pop">
                  <button type="button" className={`ribbon-inline-icon ${showFillPalette || !!selectionUi.fillColor ? "active" : ""}`} title="Fill color" aria-label="Fill color" onClick={() => { setShowFillPalette((value) => !value); setShowTextPalette(false); }} disabled={readOnly}><RibbonIcon name="fill" /></button>
                  {showFillPalette && (
                    <div className="ribbon-palette">
                      {COLOR_SWATCHES.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="color-swatch-btn"
                          style={{ background: color }}
                          onClick={() => {
                            setExclusiveClassFormat("excel-fill-", `excel-fill-${color.slice(1)}`, "fill color");
                            setShowFillPalette(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="ribbon-pop-wrap ribbon-inline-pop">
                  <button type="button" className={`ribbon-inline-icon ${showTextPalette || !!selectionUi.textColor ? "active" : ""}`} title="Font color" aria-label="Font color" onClick={() => { setShowTextPalette((value) => !value); setShowFillPalette(false); }} disabled={readOnly}><RibbonIcon name="font-color" /></button>
                  {showTextPalette && (
                    <div className="ribbon-palette">
                      {COLOR_SWATCHES.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="color-swatch-btn"
                          style={{ background: color }}
                          onClick={() => {
                            setExclusiveClassFormat("excel-text-", `excel-text-${color.slice(1)}`, "font color");
                            setShowTextPalette(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </RibbonSection>

          <RibbonSection title="Alignment">
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                <button type="button" className={`ribbon-inline-icon ribbon-large-icon ${selectionUi.verticalAlign === "top" ? "active" : ""}`} title="Align Top" aria-label="Align Top" onClick={() => setExclusiveClassFormat("excel-v-align-", "excel-v-align-top", "align top")} disabled={readOnly}><RibbonIcon name="align-top" /></button>
                <button type="button" className={`ribbon-inline-icon ribbon-large-icon ${selectionUi.verticalAlign === "middle" ? "active" : ""}`} title="Align Middle" aria-label="Align Middle" onClick={() => setExclusiveClassFormat("excel-v-align-", "excel-v-align-middle", "align middle")} disabled={readOnly}><RibbonIcon name="align-middle" /></button>
                <button type="button" className={`ribbon-inline-icon ribbon-large-icon ${selectionUi.verticalAlign === "bottom" ? "active" : ""}`} title="Align Bottom" aria-label="Align Bottom" onClick={() => setExclusiveClassFormat("excel-v-align-", "excel-v-align-bottom", "align bottom")} disabled={readOnly}><RibbonIcon name="align-bottom" /></button>
              </div>
              <div className="ribbon-home-row">
                <button type="button" className={`ribbon-inline-icon ribbon-large-icon ${selectionUi.align === "left" ? "active" : ""}`} title="Align left" aria-label="Align left" onClick={() => setExclusiveClassFormat("excel-align-", "excel-align-left", "align left")} disabled={readOnly}><RibbonIcon name="align-left" /></button>
                <button type="button" className={`ribbon-inline-icon ribbon-large-icon ${selectionUi.align === "center" ? "active" : ""}`} title="Align center" aria-label="Align center" onClick={() => setExclusiveClassFormat("excel-align-", "excel-align-center", "align center")} disabled={readOnly}><RibbonIcon name="align-center" /></button>
                <button type="button" className={`ribbon-inline-icon ribbon-large-icon ${selectionUi.align === "right" ? "active" : ""}`} title="Align right" aria-label="Align right" onClick={() => setExclusiveClassFormat("excel-align-", "excel-align-right", "align right")} disabled={readOnly}><RibbonIcon name="align-right" /></button>
                <button type="button" className={`ribbon-inline-icon ribbon-large-icon ${selectionUi.wrap ? "active" : ""}`} title="Wrap text" aria-label="Wrap text" onClick={() => toggleClassFormat("excel-wrap", "wrap text")} disabled={readOnly}><RibbonIcon name="wrap" /></button>
                <button type="button" className="ribbon-inline-icon ribbon-large-icon" title="Merge and center" aria-label="Merge and center" onClick={() => mergeSelection("merge")} disabled={readOnly}><RibbonIcon name="merge" /></button>
              </div>
            </div>
          </RibbonSection>

          <RibbonSection title="Number" wide>
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                <select value={formatChoice} className="excel-select format-select" onChange={(e) => applyFormatChoice(e.target.value)} disabled={readOnly} aria-label="Number format">
                  {NUMBER_FORMAT_OPTIONS.map((option) => (
                    <option key={option.label} value={option.label}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="ribbon-home-row">
                <RibbonGhostTool icon={<RibbonGlyph>$</RibbonGlyph>} label="Accounting" title="Accounting Number Format" layout="inline" disabled={readOnly} onClick={() => applyFormatChoice("Accounting")} />
                <RibbonGhostTool icon={<RibbonGlyph>%</RibbonGlyph>} label="Percent" title="Percent Style" layout="inline" disabled={readOnly} onClick={() => applyFormatChoice("Percent")} />
                <RibbonGhostTool icon={<RibbonGlyph>,</RibbonGlyph>} label="Comma" title="Comma Style" layout="inline" disabled={readOnly} onClick={() => applyFormatChoice("Comma")} />
              </div>
              <div className="ribbon-home-row">
                <RibbonGhostTool icon={<RibbonGlyph>.0</RibbonGlyph>} label="Dec" title="Decrease Decimal" layout="inline" disabled={readOnly} onClick={() => adjustDecimalPlaces(-1)} />
                <RibbonGhostTool icon={<RibbonGlyph>0.</RibbonGlyph>} label="Inc" title="Increase Decimal" layout="inline" disabled={readOnly} onClick={() => adjustDecimalPlaces(1)} />
                <RibbonGhostTool icon={<RibbonIcon name="table" />} label="Table" title="Format as Table" layout="inline" disabled={readOnly} onClick={applyTableFormat} />
                <RibbonGhostTool icon={<RibbonIcon name="styles" />} label="Styles" title="Cell Styles" layout="inline" disabled={readOnly} onClick={applyCellStylePreset} />
              </div>
            </div>
          </RibbonSection>

          <RibbonSection title="Editing" wide>
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                <RibbonGhostTool icon={<RibbonGlyph>Tx</RibbonGlyph>} label="Clear" title="Clear formatting" layout="inline" disabled={readOnly} onClick={clearFormatting} />
                <RibbonGhostTool icon={<RibbonIcon name="sum" />} label="AutoSum" title="AutoSum" layout="inline" disabled={readOnly} onClick={applyAutoSum} />
                <RibbonGhostTool icon={<RibbonIcon name="filter" />} label="Filter" title="Filter" layout="inline" disabled={false} onClick={applyFilter} />
                <RibbonGhostTool icon={<RibbonIcon name="find" />} label="Find" title="Find & Select" layout="inline" disabled={false} onClick={runFind} />
              </div>
              <div className="ribbon-home-row">
                <RibbonButton title="Clear formatting" onClick={clearFormatting} disabled={readOnly}><RibbonGlyph>Tx</RibbonGlyph></RibbonButton>
                <RibbonButton title="Sort ascending" onClick={() => sortSelection("asc")} disabled={readOnly}><RibbonIcon name="sort-asc" /></RibbonButton>
                <RibbonButton title="Sort descending" onClick={() => sortSelection("desc")} disabled={readOnly}><RibbonIcon name="sort-desc" /></RibbonButton>
                <RibbonButton title="Insert row" onClick={() => alterGrid("insert_row_below")} disabled={readOnly}><span className="ribbon-mini-label">R+</span></RibbonButton>
                <RibbonButton title="Insert column" onClick={() => alterGrid("insert_col_end")} disabled={readOnly}><span className="ribbon-mini-label">C+</span></RibbonButton>
              </div>
            </div>
          </RibbonSection>

          <RibbonSection title="Workbook">
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                <RibbonButton title="Save" onClick={autosave} disabled={readOnly}><RibbonIcon name="save" /></RibbonButton>
                <RibbonButton title="Undo" onClick={triggerUndo} disabled={readOnly}><RibbonIcon name="undo" /></RibbonButton>
                <RibbonButton title="Redo" onClick={triggerRedo} disabled={readOnly}><RibbonIcon name="redo" /></RibbonButton>
              </div>
            </div>
          </RibbonSection>
        </>
      );
    }

    if (activeRibbonTab === "Insert") {
      return (
        <>
          <RibbonSection title="Tables" wide>
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                <RibbonGhostTool icon={getRibbonToolIcon("PivotTable")} label="PivotTable" title="PivotTable" layout="inline" />
                <RibbonGhostTool icon={getRibbonToolIcon("Table")} label="Table" title="Table" layout="inline" />
              </div>
              <div className="ribbon-home-row">
                <RibbonGhostTool icon={getRibbonToolIcon("Recommended PivotTables")} label="Recommended" title="Recommended PivotTables" layout="inline" />
              </div>
            </div>
          </RibbonSection>
          <RibbonSection title="Illustrations" wide>
            <div className="ribbon-home-group">
              {splitIntoRows(["Pictures", "Shapes", "Icons", "SmartArt", "Screenshot"]).map((row, rowIndex) => (
                <div key={`illustrations-${rowIndex}`} className="ribbon-home-row">
                  {row.map((tool) => (
                    <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                  ))}
                </div>
              ))}
            </div>
          </RibbonSection>
          <RibbonSection title="Charts" wide>
            <div className="ribbon-home-group">
              {splitIntoRows(["Recommended Charts", "Column", "Line", "Pie", "Combo"]).map((row, rowIndex) => (
                <div key={`charts-${rowIndex}`} className="ribbon-home-row">
                  {row.map((tool) => (
                    <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                  ))}
                </div>
              ))}
            </div>
          </RibbonSection>
          <RibbonSection title="Sparklines">
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                {["Line", "Column", "Win/Loss"].map((tool) => (
                  <RibbonGhostTool key={tool} icon={getRibbonToolIcon(`Sparkline ${tool}`)} label={tool} title={tool} layout="inline" />
                ))}
              </div>
            </div>
          </RibbonSection>
          <RibbonSection title="Filters">
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                <RibbonGhostTool icon={<RibbonGlyph>Slc</RibbonGlyph>} label="Slicer" title="Slicer" layout="inline" />
                <RibbonGhostTool icon={<RibbonGlyph>Tml</RibbonGlyph>} label="Timeline" title="Timeline" layout="inline" />
              </div>
              <div className="ribbon-home-row">
                <RibbonButton title="Pivot table pane" onClick={() => setPivotOpen((value) => !value)}><RibbonIcon name="pivot" /></RibbonButton>
              </div>
            </div>
          </RibbonSection>
          <RibbonSection title="Text">
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                {["Text Box", "Header & Footer", "WordArt"].map((tool) => (
                  <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                ))}
              </div>
            </div>
          </RibbonSection>
        </>
      );
    }

    if (activeRibbonTab === "View") {
      return (
        <>
          <RibbonSection title="Workbook Views" wide>
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                {["Normal", "Page Break Preview", "Page Layout"].map((tool) => (
                  <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                ))}
              </div>
            </div>
          </RibbonSection>
          <RibbonSection title="Show" wide>
            <div className="ribbon-home-group">
              {splitIntoRows(["Ruler", "Formula Bar", "Gridlines", "Headings"], 2).map((row, rowIndex) => (
                <div key={`show-${rowIndex}`} className="ribbon-home-row">
                  {row.map((tool) => (
                    <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                  ))}
                </div>
              ))}
            </div>
          </RibbonSection>
          <RibbonSection title="Zoom">
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                {["Zoom", "100%", "Selection"].map((tool) => (
                  <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                ))}
              </div>
            </div>
          </RibbonSection>
          <RibbonSection title="Window" wide>
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                <RibbonButton title="Freeze top row" onClick={() => setFixedTopRows((value) => (value ? 0 : 1))}><RibbonIcon name="freeze-row" /></RibbonButton>
                <RibbonButton title="Freeze left column" onClick={() => setFixedLeftCols((value) => (value ? 0 : 1))}><RibbonIcon name="freeze-col" /></RibbonButton>
              </div>
              <div className="ribbon-home-row">
                {["New Window", "Arrange All", "Split"].map((tool) => (
                  <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                ))}
              </div>
            </div>
          </RibbonSection>
          <RibbonSection title="Macros">
            <div className="ribbon-home-group">
              <div className="ribbon-home-row">
                {["Macros", "Record Macro"].map((tool) => (
                  <RibbonGhostTool key={tool} icon={getRibbonToolIcon(tool)} label={tool} title={tool} layout="inline" />
                ))}
              </div>
            </div>
          </RibbonSection>
        </>
      );
    }

    const scaffoldByTab: Record<"Page Layout" | "Formulas" | "Data" | "Review", Array<{ title: string; tools: string[] }>> = {
      "Page Layout": [
        { title: "Themes", tools: ["Themes", "Colors", "Fonts", "Effects"] },
        { title: "Page Setup", tools: ["Margins", "Orientation", "Size", "Print Area", "Breaks"] },
        { title: "Scale to Fit", tools: ["Width", "Height", "Scale"] },
        { title: "Sheet Options", tools: ["Gridlines", "Headings"] },
        { title: "Arrange", tools: ["Bring Forward", "Send Backward", "Align", "Group"] },
      ],
      "Formulas": [
        { title: "Function Library", tools: ["Insert Function", "AutoSum", "Financial", "Logical", "Text"] },
        { title: "Defined Names", tools: ["Name Manager", "Define Name", "Use in Formula"] },
        { title: "Formula Auditing", tools: ["Trace Precedents", "Trace Dependents", "Error Checking", "Evaluate Formula"] },
        { title: "Calculation", tools: ["Calculation Options", "Calculate Now", "Calculate Sheet"] },
      ],
      "Data": [
        { title: "Get & Transform", tools: ["Get Data", "From Text/CSV", "Queries & Connections"] },
        { title: "Sort & Filter", tools: ["Sort", "Filter", "Advanced"] },
        { title: "Data Tools", tools: ["Text to Columns", "Flash Fill", "Data Validation", "Remove Duplicates"] },
        { title: "Forecast", tools: ["What-If Analysis", "Forecast Sheet"] },
        { title: "Outline", tools: ["Group", "Ungroup", "Subtotal"] },
      ],
      "Review": [
        { title: "Proofing", tools: ["Spelling", "Thesaurus", "Translate"] },
        { title: "Accessibility", tools: ["Check Accessibility"] },
        { title: "Comments", tools: ["New Comment", "Show Comments", "Notes"] },
        { title: "Protect", tools: ["Protect Sheet", "Protect Workbook", "Allow Edit Ranges"] },
      ],
    };

    return scaffoldByTab[activeRibbonTab as keyof typeof scaffoldByTab].map((section) => (
      <RibbonSection key={section.title} title={section.title} wide>
        <div className="ribbon-home-group">
          {splitIntoRows(section.tools, 2).map((row, rowIndex) => (
            <div key={`${section.title}-${rowIndex}`} className="ribbon-home-row">
              {row.map((tool) => (
                <RibbonGhostTool
                  key={tool}
                  icon={getRibbonToolIcon(tool)}
                  label={tool}
                  title={tool}
                  layout="inline"
                />
              ))}
            </div>
          ))}
        </div>
      </RibbonSection>
    ));
  };

  return (
    <section className={`excel-assessment ${candidateMode ? "candidate" : ""} ${embedded ? "embedded" : ""}`}>
      <div className="excel-topbar">
        <div className="excel-topbar-copy">
          <p>{description || title}</p>
        </div>
        <div className="excel-topbar-side">
          {showTopbarActions && (
            <div className="excel-topbar-actions">
              <button type="button" className="excel-topbar-icon-btn" title="Reset workbook" aria-label="Reset workbook" onClick={resetWorkbook}>
                <TopbarIcon kind="reset" />
              </button>
              <button type="button" className="excel-topbar-icon-btn danger" title="Cancel and exit" aria-label="Cancel and exit" onClick={cancelWorkbook}>
                <TopbarIcon kind="cancel" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="excel-ribbon-shell">
        <div className="excel-ribbon-tabbar" role="tablist" aria-label="Excel ribbon tabs">
          {ribbonTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={`excel-ribbon-tab ${activeRibbonTab === tab ? "active" : ""}`}
              aria-selected={activeRibbonTab === tab}
              onClick={() => setActiveRibbonTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="excel-ribbon excel-ribbon-rich" aria-label="Excel ribbon">
          {renderRibbonTabContent()}
          {onSubmit && activeRibbonTab === "Home" && <button type="button" className="excel-submit" onClick={() => void submit()}>Submit</button>}
        </div>
      </div>

      <div className="formula-bar">
        <input
          className="name-box name-box-input"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") jumpToCell();
          }}
          aria-label="Cell reference"
        />
        <span className="fx">fx</span>
        <div className="formula-input-wrap">
          <input
            ref={formulaInputRef}
            value={formulaText}
            disabled={readOnly || lockedSet.has(selectedCell)}
            onChange={(e) => {
              setFormulaText(e.target.value);
              setFormulaSuggestionMode("bar");
              setFormulaSuggestionIndex(0);
            }}
            onBlur={commitFormulaBar}
            onFocus={() => {
              if (formulaText.startsWith("=")) setFormulaSuggestionMode("bar");
            }}
            onKeyDown={(e) => {
              if (showFormulaBarSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                const direction = e.key === "ArrowDown" ? 1 : -1;
                setFormulaSuggestionIndex((previous) => (previous + direction + formulaSuggestions.length) % formulaSuggestions.length);
                return;
              }
              if (showFormulaBarSuggestions && (e.key === "Enter" || e.key === "Tab")) {
                e.preventDefault();
                applyFormulaSuggestion(formulaSuggestions[formulaSuggestionIndex].name);
                return;
              }
              if (e.key === "Escape") {
                setFormulaSuggestionIndex(0);
                return;
              }
              if (e.key === "Enter") commitFormulaBar();
            }}
            aria-label="Formula bar"
          />
          {showFormulaBarSuggestions && renderFormulaSuggestionList()}
        </div>
      </div>
      <div className="excel-context-strip">
        <div className="excel-context-group">
          <span className="excel-context-chip strong">{selectedCell}</span>
          <span className="excel-context-chip">{activeSheet.name}</span>
          <span className="excel-context-chip">{readOnly || lockedSet.has(selectedCell) ? "Locked cell" : "Editable cell"}</span>
          {formatPainterPayload && <span className="excel-context-chip accent">Painter armed</span>}
          {clipboardPayload && <span className="excel-context-chip">Clipboard ready</span>}
        </div>
        <span className="excel-context-status">{status}</span>
      </div>

      <ExcelErrorBoundary>
      <div className={`excel-main-surface ${pivotOpen ? "with-pivot" : ""}`}>
        <div ref={gridShellRef} className="excel-grid-shell">
        <HotTable
          key={`${activeSheet.id}:${sheetViewVersion}`}
          ref={hotRef}
          data={activeSheetData}
          colHeaders
          rowHeaders
          width="100%"
          height={embedded ? "calc(100dvh - 248px)" : "calc(100dvh - 278px)"}
          stretchH="none"
          licenseKey="non-commercial-and-evaluation"
          formulas={{ engine: engineRef.current, sheetName: activeSheet.name }}
          contextMenu
          manualColumnResize
          manualRowResize
          fixedRowsTop={fixedTopRows}
          fixedColumnsStart={fixedLeftCols}
          copyPaste
          fillHandle
          undo
          mergeCells
          comments
          dropdownMenu
          filters
          autoWrapCol
          autoWrapRow
          minSpareRows={MIN_SPARE_ROWS}
          minSpareCols={MIN_SPARE_COLS}
          viewportColumnRenderingOffset={30}
          viewportRowRenderingOffset={30}
          colWidths={64}
          rowHeights={18}
          rowHeaderWidth={38}
          columnHeaderHeight={22}
          readOnly={readOnly}
          cells={(row, col) => ({
            readOnly: readOnly || lockedSet.has(refFor(row, col)),
          })}
          afterGetCellMeta={(row, col, cellProperties) => {
            const dynamicClasses = parseClassTokens((cellProperties as Record<string, unknown>).excelClasses);
            const classes = new Set(dynamicClasses);
            if (lockedSet.has(refFor(row, col))) classes.add("excel-locked-cell");
            cellProperties.className = Array.from(classes).join(" ");
          }}
          afterSelectionEnd={(row, col) => {
            window.requestAnimationFrame(() => {
              updateSelectionDisplay(row, col);
              updateSelectionSummary();
              syncCellFormulaSuggestions();
            });
          }}
          afterBeginEditing={() => {
            setFormulaSuggestionIndex(0);
            attachCellFormulaEditor();
          }}
          beforeKeyDown={(event) => {
            const isTypingKey = event.key.length === 1 || event.key === "Backspace" || event.key === "Delete";
            if (isTypingKey) {
              window.requestAnimationFrame(() => {
                setFormulaSuggestionMode("cell");
                syncCellFormulaSuggestions();
              });
            }
            if (!showCellFormulaSuggestions) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              event.stopImmediatePropagation();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setFormulaSuggestionIndex((previous) => (previous + direction + formulaSuggestions.length) % formulaSuggestions.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              event.stopImmediatePropagation();
              applyFormulaSuggestion(formulaSuggestions[formulaSuggestionIndex].name);
              return;
            }
            if (event.key === "Escape") {
              setFormulaSuggestionMode(null);
              setCellFormulaOverlay(null);
              setFormulaSuggestionIndex(0);
            }
          }}
          afterChange={(changes, source) => {
            try {
              if (!changes || source === "loadData") return;
              changes.forEach(([row, prop, oldValue, newValue]) => {
                const col = typeof prop === "number" ? prop : Number(prop);
                appendLog({ type: source || "edit", cell: `${activeSheet.name}!${refFor(Number(row), col)}`, from: oldValue, to: newValue });
              });
              window.requestAnimationFrame(() => syncCellFormulaSuggestions());
            } catch (error) {
              console.error("Excel change handler failed", error);
            }
          }}
          afterCopy={() => appendLog({ type: "copy", cell: `${activeSheet.name}!${selectedCell}` })}
          afterCut={() => appendLog({ type: "cut", cell: `${activeSheet.name}!${selectedCell}` })}
          afterPaste={() => appendLog({ type: "paste", cell: `${activeSheet.name}!${selectedCell}` })}
        />
        {showCellFormulaSuggestions && cellFormulaOverlay && (
          <div
            className="cell-formula-suggestions"
            style={{ left: `${cellFormulaOverlay.left}px`, top: `${cellFormulaOverlay.top}px`, width: `${cellFormulaOverlay.width}px` }}
          >
            {renderFormulaSuggestionList(true)}
          </div>
        )}
        </div>
        {pivotOpen && (
          <aside className="pivot-task-pane">
            <div className="pivot-task-head">
              <strong>PivotTable Fields</strong>
              <span>Choose fields to add to report:</span>
            </div>
            <div className="pivot-field-list">
              {pivotSource.headers.map((header) => (
                <div key={header} className="pivot-field-item">
                  <span>{header}</span>
                  <div className="pivot-field-actions">
                    <button type="button" onClick={() => setPivotConfig((prev) => ({ ...prev, rowField: header }))}>Rows</button>
                    <button type="button" onClick={() => setPivotConfig((prev) => ({ ...prev, columnField: header }))}>Cols</button>
                    <button type="button" onClick={() => setPivotConfig((prev) => ({ ...prev, valueField: header }))}>Vals</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="pivot-zone-grid">
              <div className="pivot-zone">
                <span className="pivot-zone-label">Rows</span>
                <strong>{pivotConfig.rowField || "Drop field"}</strong>
              </div>
              <div className="pivot-zone">
                <span className="pivot-zone-label">Columns</span>
                <strong>{pivotConfig.columnField || "Drop field"}</strong>
              </div>
              <div className="pivot-zone pivot-zone-wide">
                <span className="pivot-zone-label">Values</span>
                <div className="pivot-value-line">
                  <strong>{pivotConfig.valueField || "Drop field"}</strong>
                  <select value={pivotConfig.aggregation} onChange={(e) => setPivotConfig((prev) => ({ ...prev, aggregation: e.target.value as PivotConfig["aggregation"] }))}>
                    <option value="sum">Sum</option>
                    <option value="avg">Average</option>
                    <option value="count">Count</option>
                    <option value="max">Max</option>
                    <option value="min">Min</option>
                  </select>
                </div>
              </div>
            </div>
            {pivotResult && (
              <div className="pivot-result">
                <table>
                  <thead>
                    <tr>
                      <th>{pivotResult.rowField || "Rows"}</th>
                      {pivotResult.columns.map((column) => <th key={column}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pivotResult.rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.key}</td>
                        {row.values.map((value, index) => <td key={`${row.key}-${pivotResult.columns[index]}`}>{Number(value).toFixed(2)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        )}
      </div>
      </ExcelErrorBoundary>

      <div className="excel-bottom-bar excel-bottom-tabs">
        <div className="sheet-tabs">
          {sheets.map((sheet) => (
            <div key={sheet.id} className={`sheet-tab-chip ${sheet.id === activeSheet.id ? "active" : ""}`}>
              <button type="button" className="sheet-tab-main" onClick={() => switchSheet(sheet.id)}>
                {sheet.name}
              </button>
              <button type="button" className="sheet-tab-tool" onClick={() => renameSheet(sheet.id)} title="Rename sheet">Edit</button>
              {sheets.length > 1 && <button type="button" className="sheet-tab-tool sheet-tab-close" onClick={() => removeSheet(sheet.id)} title="Remove sheet">x</button>}
            </div>
          ))}
          <button type="button" className="sheet-tab-add" onClick={addSheet} title="Add sheet">+</button>
        </div>
        <div className="excel-footer-meta">
          <span className="excel-footer-pill">{status}</span>
          <span>Count: {selectionSummary.count}</span>
          <span>Numbers: {selectionSummary.numericCount}</span>
          {selectionSummary.sum != null && <span>Sum: {selectionSummary.sum.toFixed(2)}</span>}
          {selectionSummary.average != null && <span>Average: {selectionSummary.average.toFixed(2)}</span>}
          {selectionSummary.min != null && <span>Min: {selectionSummary.min.toFixed(2)}</span>}
          {selectionSummary.max != null && <span>Max: {selectionSummary.max.toFixed(2)}</span>}
          <span>Active sheet: {activeSheet.name}</span>
        </div>
      </div>
    </section>
  );
}
