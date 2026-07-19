import { useMemo, useState } from "react";
import "./AccountingTool.css";

type Transaction = {
  id: number;
  date: string;
  type: "Expense" | "Bill" | "Invoice";
  name: string;
  category: string;
  amount: number;
  status: "Paid" | "Open" | "Overdue";
};

type CatalogEntry = {
  name: string;
  category: string;
  rate: number;
  tax: string;
  terms: string;
};

const catalog: CatalogEntry[] = [
  { name: "Adobe Systems", category: "Software & subscriptions", rate: 59.99, tax: "Taxable", terms: "Due on receipt" },
  { name: "Acme Office Supply", category: "Office supplies", rate: 125, tax: "Taxable", terms: "Net 30" },
  { name: "City Electric", category: "Utilities", rate: 240, tax: "Non-taxable", terms: "Net 15" },
  { name: "Northstar Consulting", category: "Professional services", rate: 850, tax: "Non-taxable", terms: "Net 30" },
];

const initialTransactions: Transaction[] = [
  { id: 1, date: "Jul 18, 2026", type: "Expense", name: "Adobe Systems", category: "Software & subscriptions", amount: 59.99, status: "Paid" },
  { id: 2, date: "Jul 17, 2026", type: "Bill", name: "Northstar Consulting", category: "Professional services", amount: 850, status: "Open" },
  { id: 3, date: "Jul 15, 2026", type: "Expense", name: "City Electric", category: "Utilities", amount: 240, status: "Paid" },
  { id: 4, date: "Jul 12, 2026", type: "Invoice", name: "Brightline Studio", category: "Design services", amount: 1450, status: "Overdue" },
];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function AccountingTool() {
  const [activePage, setActivePage] = useState("Transactions");
  const [search, setSearch] = useState("");
  const [transactions, setTransactions] = useState(initialTransactions);
  const [showForm, setShowForm] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [form, setForm] = useState({ name: "", category: "", rate: "", tax: "", terms: "", date: "2026-07-19" });

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return transactions;
    return transactions.filter((transaction) => Object.values(transaction).some((value) => String(value).toLowerCase().includes(query)));
  }, [search, transactions]);

  const total = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const matchingCatalog = catalog.filter((entry) => entry.name.toLowerCase().includes(form.name.toLowerCase()));

  function updateName(name: string) {
    const match = catalog.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    setForm((current) => match
      ? { ...current, name: match.name, category: match.category, rate: String(match.rate), tax: match.tax, terms: match.terms }
      : { ...current, name });
  }

  function saveTransaction() {
    const amount = Number(form.rate);
    if (!form.name.trim() || !form.category.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setTransactions((current) => [{
      id: Date.now(), date: new Date(`${form.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      type: "Expense", name: form.name, category: form.category, amount, status: "Paid",
    }, ...current]);
    setForm({ name: "", category: "", rate: "", tax: "", terms: "", date: "2026-07-19" });
    setShowForm(false);
    setSavedNotice("Expense saved");
    window.setTimeout(() => setSavedNotice(""), 2400);
  }

  return (
    <div className="accounting-app">
      <aside className="accounting-sidebar">
        <div className="accounting-brand"><span className="accounting-brand-mark">C</span><strong>Certora Books</strong></div>
        <button className="accounting-create-btn" type="button" onClick={() => setShowForm(true)}>+ Create</button>
        <nav aria-label="Accounting navigation">
          {["Home", "Transactions", "Sales", "Expenses", "Reports", "Taxes"].map((page) => (
            <button key={page} className={activePage === page ? "active" : ""} type="button" onClick={() => setActivePage(page)}>
              <span aria-hidden="true">{page === "Home" ? "⌂" : page === "Transactions" ? "↔" : page === "Sales" ? "▣" : page === "Expenses" ? "$" : page === "Reports" ? "▥" : "%"}</span>{page}
            </button>
          ))}
        </nav>
        <div className="accounting-sidebar-footer"><button type="button">⚙ Settings</button><small>Business checking •••• 4821</small></div>
      </aside>

      <main className="accounting-main">
        <header className="accounting-topbar">
          <div><span className="accounting-kicker">ACME DESIGN CO.</span><h1>{activePage}</h1></div>
          <div className="accounting-top-actions"><button className="accounting-icon-btn" title="Search" type="button">⌕</button><button className="accounting-icon-btn" title="Notifications" type="button">♢</button><span className="accounting-avatar">AR</span></div>
        </header>

        {activePage === "Transactions" ? <>
          <section className="accounting-summary-row">
            <div><span>Cash balance</span><strong>{money(24860.42)}</strong><small className="positive">↑ 8.2% this month</small></div>
            <div><span>Income this month</span><strong>{money(12840)}</strong><small>14 transactions</small></div>
            <div><span>Expenses this month</span><strong>{money(total)}</strong><small>4 transactions</small></div>
            <div><span>Open bills</span><strong>{money(850)}</strong><small className="warning">1 needs attention</small></div>
          </section>
          <section className="accounting-content-panel">
            <div className="accounting-panel-head"><div><h2>Recent transactions</h2><p>Review, categorize, and match your latest activity.</p></div><button className="accounting-primary-btn" type="button" onClick={() => setShowForm(true)}>+ Add expense</button></div>
            <div className="accounting-toolbar"><div className="accounting-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" aria-label="Search transactions" /></div><select aria-label="Filter transactions"><option>All transactions</option><option>Expenses</option><option>Bills</option><option>Invoices</option></select><button className="accounting-filter-btn" type="button">☷ Filter</button></div>
            <div className="accounting-table-wrap"><table className="accounting-table"><thead><tr><th><input type="checkbox" aria-label="Select all transactions" /></th><th>Date</th><th>Type</th><th>Name</th><th>Category</th><th>Status</th><th className="number-cell">Amount</th><th aria-label="Actions" /></tr></thead><tbody>{filteredTransactions.map((transaction) => <tr key={transaction.id}><td><input type="checkbox" aria-label={`Select ${transaction.name}`} /></td><td>{transaction.date}</td><td><span className="transaction-type">{transaction.type}</span></td><td><strong>{transaction.name}</strong></td><td>{transaction.category}</td><td><span className={`transaction-status ${transaction.status.toLowerCase()}`}>{transaction.status}</span></td><td className="number-cell"><strong>{money(transaction.amount)}</strong></td><td><button className="accounting-row-action" title="More actions" type="button">•••</button></td></tr>)}</tbody></table></div>
            {filteredTransactions.length === 0 && <div className="accounting-empty">No transactions match that search.</div>}
            <div className="accounting-table-footer"><span>{filteredTransactions.length} transactions</span><span>Showing this month <button type="button">View all →</button></span></div>
          </section>
        </> : <section className="accounting-content-panel accounting-placeholder"><span className="accounting-kicker">WORKSPACE</span><h2>{activePage}</h2><p>This workspace is ready for your bookkeeping workflow. Use Transactions to review and enter activity.</p><button className="accounting-primary-btn" type="button" onClick={() => setActivePage("Transactions")}>View transactions</button></section>}
      </main>

      {showForm && <div className="accounting-modal-backdrop" role="presentation" onMouseDown={() => setShowForm(false)}><section className="accounting-form-panel" role="dialog" aria-modal="true" aria-labelledby="accounting-form-title" onMouseDown={(event) => event.stopPropagation()}><div className="accounting-form-head"><div><span className="accounting-kicker">NEW TRANSACTION</span><h2 id="accounting-form-title">Add expense</h2><p>Start typing a name and matching details fill automatically.</p></div><button className="accounting-icon-btn" title="Close" type="button" onClick={() => setShowForm(false)}>×</button></div><div className="accounting-form-grid"><label className="field-stack"><span>Payment date</span><input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></label><label className="field-stack accounting-form-wide"><span>Payee <em>Auto-filled from history</em></span><input list="accounting-payees" autoFocus value={form.name} onChange={(event) => updateName(event.target.value)} placeholder="Search or add a payee" /><datalist id="accounting-payees">{catalog.map((entry) => <option key={entry.name} value={entry.name} />)}</datalist>{form.name && matchingCatalog.length > 0 && <small className="autofill-hint">✓ Details found for {matchingCatalog[0].name}</small>}</label><label className="field-stack"><span>Category</span><input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="e.g. Office supplies" /></label><label className="field-stack"><span>Amount</span><input type="number" min="0" step="0.01" value={form.rate} onChange={(event) => setForm((current) => ({ ...current, rate: event.target.value }))} placeholder="0.00" /></label><label className="field-stack"><span>Tax treatment</span><select value={form.tax} onChange={(event) => setForm((current) => ({ ...current, tax: event.target.value }))}><option value="">Select tax treatment</option><option>Taxable</option><option>Non-taxable</option></select></label><label className="field-stack"><span>Terms</span><select value={form.terms} onChange={(event) => setForm((current) => ({ ...current, terms: event.target.value }))}><option value="">Select terms</option><option>Due on receipt</option><option>Net 15</option><option>Net 30</option></select></label></div><div className="accounting-autofill-callout"><strong>Smart fill is on</strong><span>Payee history will remember category, tax treatment, terms, and amount for faster entry.</span></div><div className="accounting-form-footer"><button className="secondary-btn" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="accounting-primary-btn" type="button" onClick={saveTransaction}>Save expense</button></div></section></div>}
      {savedNotice && <div className="accounting-saved-notice" role="status">✓ {savedNotice}</div>}
    </div>
  );
}
