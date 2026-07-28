type AssessmentToolIconProps = {
  assessmentType?: string;
  title?: string;
  toolName?: string;
  className?: string;
};

function toolKind({ assessmentType = "", title = "", toolName = "" }: AssessmentToolIconProps) {
  const value = `${assessmentType} ${title} ${toolName}`.toLowerCase();
  if (value.includes("spreadsheet") || value.includes("excel")) return "excel";
  if (value.includes("tax")) return "drake-tax";
  if (value.includes("coding") || value.includes("code") || value.includes("developer")) return "vscode";
  if (value.includes("account") || value.includes("bookkeep") || value.includes("gnucash")) return "quickbooks";
  return "tools";
}

export function AssessmentToolIcon(props: AssessmentToolIconProps) {
  const kind = toolKind(props);
  const className = `${props.className || "assessment-tool-icon"} assessment-tool-icon-${kind}`;
  if (kind === "tools") {
    return <span className={className} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5l-7.8 7.8a2.1 2.1 0 1 0 3 3l7.8-7.8a4 4 0 0 0 5-5L17 10l-2.4-2.4 2.3-2.3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span>;
  }
  const labels: Record<string, string> = { excel: "Microsoft Excel", "quickbooks": "QuickBooks", "drake-tax": "Drake Tax", vscode: "Visual Studio Code" };
  const assets: Record<string, string> = {
    excel: "excel-official.svg",
    quickbooks: "quickbooks-official.svg",
    "drake-tax": "drake-tax.png",
    vscode: "vscode.png",
  };
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  return <img className={className} src={`${base}assets/tools/${assets[kind]}`} alt={labels[kind]} />;
}
