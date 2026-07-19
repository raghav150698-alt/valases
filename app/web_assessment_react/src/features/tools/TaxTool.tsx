import { useMemo, useState } from "react";
import "./TaxTool.css";

type TaxField = { key: string; label: string; value: string; hint?: string };

const initialFields: TaxField[] = [
  { key: "firstName", label: "First name", value: "Alex" },
  { key: "lastName", label: "Last name", value: "Rivera" },
  { key: "ssn", label: "Social Security number", value: "***-**-4821", hint: "Protected" },
  { key: "wages", label: "Wages, salaries, tips", value: "84200" },
  { key: "federalWithholding", label: "Federal income tax withheld", value: "11840" },
  { key: "interest", label: "Taxable interest", value: "620" },
  { key: "charitable", label: "Charitable contributions", value: "1250" },
];

const sections = ["Client Information", "Income", "Adjustments", "Deductions", "Credits", "Review & File"];

function currency(value: string) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

export function TaxTool() {
  const [activeSection, setActiveSection] = useState("Client Information");
  const [fields, setFields] = useState(initialFields);
  const [saved, setSaved] = useState(false);
  const field = (key: string) => fields.find((item) => item.key === key)?.value || "";
  const wages = Number(field("wages") || 0);
  const interest = Number(field("interest") || 0);
  const withholding = Number(field("federalWithholding") || 0);
  const estimatedTax = Math.max(0, Math.round((wages + interest) * 0.14 - 9500));
  const refund = withholding - estimatedTax;
  const completion = useMemo(() => Math.round((fields.filter((item) => item.value.trim()).length / fields.length) * 100), [fields]);

  function updateField(key: string, value: string) {
    setFields((current) => current.map((item) => item.key === key ? { ...item, value } : item));
    setSaved(false);
  }

  return <div className="tax-app">
    <aside className="tax-sidebar">
      <div className="tax-brand"><span className="tax-brand-mark">D</span><div><strong>Certora Tax</strong><small>2026 Professional</small></div></div>
      <div className="tax-client-card"><span>RETURN IN PROGRESS</span><strong>Rivera, Alex</strong><small>Federal 1040 · 2025</small></div>
      <nav aria-label="Tax return sections">{sections.map((section, index) => <button type="button" key={section} className={activeSection === section ? "active" : ""} onClick={() => setActiveSection(section)}><span>{index + 1}</span>{section}{index < 3 && <em>✓</em>}</button>)}</nav>
      <div className="tax-sidebar-footer"><small>Preparer: Jordan Lee</small><button type="button">⚙ Preferences</button></div>
    </aside>
    <main className="tax-main">
      <header className="tax-topbar"><div><span className="tax-kicker">FEDERAL RETURN · 2025 TAX YEAR</span><h1>{activeSection}</h1></div><div className="tax-top-actions"><span className="tax-status-pill">Draft</span><button title="Save return" type="button" onClick={() => setSaved(true)}>Save</button><button title="Help" type="button">?</button><span className="tax-avatar">JL</span></div></header>
      <div className="tax-workspace">
        <section className="tax-form-surface"><div className="tax-surface-head"><div><h2>{activeSection === "Client Information" ? "Taxpayer information" : activeSection}</h2><p>Enter information once and the return updates automatically.</p></div><span className="tax-completion">{completion}% complete</span></div>{activeSection === "Client Information" && <div className="tax-form-grid">{fields.slice(0, 3).map((item) => <label className="field-stack" key={item.key}><span>{item.label} {item.hint && <em>{item.hint}</em>}</span><input value={item.value} onChange={(event) => updateField(item.key, event.target.value)} /></label>)}<label className="field-stack tax-wide"><span>Filing status</span><select defaultValue="single"><option value="single">Single</option><option value="joint">Married filing jointly</option><option value="head">Head of household</option></select></label></div>}{activeSection === "Income" && <div className="tax-form-grid">{fields.slice(3, 6).map((item) => <label className="field-stack" key={item.key}><span>{item.label}</span><div className="tax-input-prefix"><b>$</b><input type="number" value={item.value} onChange={(event) => updateField(item.key, event.target.value)} /></div></label>)}<div className="tax-info-callout"><strong>Smart carryforward</strong><span>Prior-year values and imported documents can prefill recurring income fields.</span></div></div>}{activeSection === "Deductions" && <div className="tax-form-grid">{fields.slice(6).map((item) => <label className="field-stack" key={item.key}><span>{item.label}</span><div className="tax-input-prefix"><b>$</b><input type="number" value={item.value} onChange={(event) => updateField(item.key, event.target.value)} /></div></label>)}<label className="field-stack"><span>Deduction method</span><select defaultValue="standard"><option value="standard">Standard deduction</option><option value="itemized">Itemized deductions</option></select></label></div>}{!['Client Information','Income','Deductions'].includes(activeSection) && <div className="tax-empty-section"><strong>{activeSection} is ready</strong><p>Complete the fields in this section to calculate the return and surface missing information.</p><button type="button" onClick={() => setActiveSection("Client Information")}>Review taxpayer information</button></div>}<div className="tax-form-footer"><button type="button" className="tax-secondary-btn" onClick={() => setActiveSection(sections[Math.max(0, sections.indexOf(activeSection) - 1)])}>← Back</button><button type="button" className="tax-primary-btn" onClick={() => setActiveSection(sections[Math.min(sections.length - 1, sections.indexOf(activeSection) + 1)])}>Next section →</button></div></section>
        <aside className="tax-summary"><div className="tax-summary-head"><span>RETURN SUMMARY</span><button type="button" title="Refresh calculation">↻</button></div><div className={`tax-result ${refund >= 0 ? "refund" : "balance"}`}><span>{refund >= 0 ? "Estimated federal refund" : "Estimated amount due"}</span><strong>{currency(String(Math.abs(refund)))}</strong><small>Based on information entered</small></div><dl><div><dt>Adjusted gross income</dt><dd>{currency(String(wages + interest))}</dd></div><div><dt>Federal withholding</dt><dd>{currency(String(withholding))}</dd></div><div><dt>Estimated tax</dt><dd>{currency(String(estimatedTax))}</dd></div></dl><div className="tax-review-list"><strong>Review alerts</strong><span>✓ Personal information complete</span><span>! Verify withholding source</span><span>! Add any dependents or credits</span></div></aside>
      </div>
    </main>{saved && <div className="tax-saved-notice" role="status">✓ Return saved</div>}
  </div>;
}
