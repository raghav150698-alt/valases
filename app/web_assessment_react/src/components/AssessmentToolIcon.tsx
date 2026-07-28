import { BookOpenCheck } from "lucide-react";

type AssessmentToolIconProps = {
  assessmentType?: string;
  title?: string;
  toolName?: string;
  className?: string;
};

function toolKind({ assessmentType = "", title = "", toolName = "" }: AssessmentToolIconProps) {
  const value = `${assessmentType} ${title} ${toolName}`.toLowerCase();
  if (value.includes("spreadsheet") || value.includes("excel")) return "excel";
  if (value.includes("tax_1120") || value.includes("1120") || value.includes("corporate tax")) return "tax-1120";
  if (value.includes("tax_simulator") || value.includes("1040") || value.includes("individual tax")) return "tax-1040";
  if (value.includes("tax")) return "tax-1040";
  if (value.includes("coding") || value.includes("code") || value.includes("developer")) return "vscode";
  if (value.includes("account") || value.includes("bookkeep") || value.includes("gnucash") || value.includes("ledgebook")) return "ledgebook";
  return "tools";
}

export function AssessmentToolIcon(props: AssessmentToolIconProps) {
  const kind = toolKind(props);
  const className = `${props.className || "assessment-tool-icon"} assessment-tool-icon-${kind}`;
  if (kind === "tools") {
    return <span className={className} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5l-7.8 7.8a2.1 2.1 0 1 0 3 3l7.8-7.8a4 4 0 0 0 5-5L17 10l-2.4-2.4 2.3-2.3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span>;
  }
  if (kind === "tax-1040" || kind === "tax-1120") {
    return <span className={className} role="img" aria-label={kind === "tax-1040" ? "1040 Individual Tax" : "1120 Corporate Tax"}><span>{kind === "tax-1040" ? "1040" : "1120"}</span></span>;
  }
  if (kind === "ledgebook") {
    return <span className={className} role="img" aria-label="LedgeBook"><BookOpenCheck aria-hidden="true" /></span>;
  }
  const labels: Record<string, string> = { excel: "Microsoft Excel", vscode: "Visual Studio Code" };
  const assets: Record<string, string> = {
    excel: "excel-official.svg",
    vscode: "vscode.png",
  };
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  return <img className={className} src={`${base}assets/tools/${assets[kind]}`} alt={labels[kind]} />;
}
