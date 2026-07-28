import {
  ChevronRight,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Inbox,
  Mail,
  Monitor,
  Paperclip,
  Search,
  Volume2,
  Wifi,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import "./CaseEvidenceDesk.css";

export type CaseDocument = {
  id: string;
  name: string;
  format: "PDF" | "XLSX" | "DOCX";
  description: string;
  pages?: number;
  sections: Array<{
    heading?: string;
    lines?: Array<{ label: string; value: string; emphasis?: boolean }>;
    table?: { columns: string[]; rows: string[][] };
    note?: string;
  }>;
};

export type CaseMessage = {
  id: string;
  sender: string;
  senderRole: string;
  subject: string;
  receivedAt: string;
  preview: string;
  body: string[];
  attachmentIds: string[];
  unread?: boolean;
};

type CaseEvidenceDeskProps = {
  productName: string;
  documents: CaseDocument[];
  messages: CaseMessage[];
  onActivity?: (action: string, detail: string) => void;
};

function DocumentIcon({ format }: { format: CaseDocument["format"] }) {
  return format === "XLSX" ? <FileSpreadsheet size={18} /> : <FileText size={18} />;
}

export function CaseEvidenceDesk({ productName, documents, messages, onActivity }: CaseEvidenceDeskProps) {
  const [openApp, setOpenApp] = useState<"mail" | "files" | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState(messages[0]?.id || "");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [mailSearch, setMailSearch] = useState("");
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) || messages[0];
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) || null;
  const unreadCount = messages.filter((message) => message.unread).length;
  const filteredMessages = useMemo(() => {
    const query = mailSearch.trim().toLowerCase();
    if (!query) return messages;
    return messages.filter((message) => `${message.sender} ${message.subject} ${message.preview}`.toLowerCase().includes(query));
  }, [mailSearch, messages]);

  function openDeskApp(app: "mail" | "files") {
    setOpenApp(app);
    setSelectedDocumentId(null);
    onActivity?.("case_app_opened", app === "mail" ? "Case mailbox opened" : "Case documents opened");
  }

  function previewDocument(documentId: string) {
    const document = documents.find((item) => item.id === documentId);
    if (!document) return;
    setSelectedDocumentId(documentId);
    onActivity?.("evidence_viewed", `${document.name} opened`);
  }

  return (
    <>
      {openApp && (
        <section className="case-desk-window" role="dialog" aria-modal="false" aria-label={openApp === "mail" ? "Case mailbox" : "Case documents"}>
          <header className="case-desk-titlebar">
            <div>{openApp === "mail" ? <Mail size={16} /> : <FolderOpen size={16} />}<strong>{openApp === "mail" ? "Mail" : "Documents"}</strong></div>
            <button type="button" aria-label="Close" onClick={() => setOpenApp(null)}><X size={17} /></button>
          </header>

          {openApp === "mail" ? (
            <div className="case-mail-layout">
              <aside className="case-mail-folders">
                <strong>{productName} Mail</strong>
                <button className="active" type="button"><Inbox size={15} /><span>Inbox</span><em>{unreadCount}</em></button>
                <button type="button"><Paperclip size={15} /><span>Attachments</span></button>
              </aside>
              <div className="case-mail-list">
                <label><Search size={14} /><input value={mailSearch} onChange={(event) => setMailSearch(event.target.value)} placeholder="Search mail" /></label>
                <div>
                  {filteredMessages.map((message) => (
                    <button
                      key={message.id}
                      className={`${message.id === selectedMessage?.id ? "selected" : ""}${message.unread ? " unread" : ""}`}
                      type="button"
                      onClick={() => { setSelectedMessageId(message.id); setSelectedDocumentId(null); }}
                    >
                      <span><strong>{message.sender}</strong><time>{message.receivedAt}</time></span>
                      <b>{message.subject}</b>
                      <small>{message.preview}</small>
                      {message.attachmentIds.length > 0 && <em><Paperclip size={12} />{message.attachmentIds.length}</em>}
                    </button>
                  ))}
                </div>
              </div>
              <article className="case-mail-reading">
                {selectedMessage && (
                  <>
                    <header>
                      <span>Inbox <ChevronRight size={12} /> {selectedMessage.sender}</span>
                      <h2>{selectedMessage.subject}</h2>
                      <div><span className="case-sender-avatar">{selectedMessage.sender.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><p><strong>{selectedMessage.sender}</strong><small>{selectedMessage.senderRole} | {selectedMessage.receivedAt}</small></p></div>
                    </header>
                    <div className="case-message-body">{selectedMessage.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
                    {selectedMessage.attachmentIds.length > 0 && (
                      <footer>
                        <strong><Paperclip size={14} />Attachments</strong>
                        <div>{selectedMessage.attachmentIds.map((id) => {
                          const document = documents.find((item) => item.id === id);
                          return document ? <button key={id} type="button" onClick={() => previewDocument(id)}><DocumentIcon format={document.format} /><span><b>{document.name}</b><small>{document.format} | Preview</small></span></button> : null;
                        })}</div>
                      </footer>
                    )}
                  </>
                )}
              </article>
            </div>
          ) : (
            <div className="case-files-layout">
              <aside><FolderOpen size={18} /><strong>Client file</strong><small>{documents.length} case documents</small></aside>
              <div>
                <header><span>Name</span><span>Type</span><span>Description</span></header>
                {documents.map((document) => (
                  <button key={document.id} type="button" onClick={() => previewDocument(document.id)}>
                    <DocumentIcon format={document.format} /><strong>{document.name}</strong><span>{document.format}</span><small>{document.description}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {selectedDocument && (
        <div className="case-document-backdrop" role="presentation" onMouseDown={() => setSelectedDocumentId(null)}>
          <article className="case-document-viewer" role="dialog" aria-modal="true" aria-labelledby="case-document-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><DocumentIcon format={selectedDocument.format} /><span><strong id="case-document-title">{selectedDocument.name}</strong><small>{selectedDocument.format}{selectedDocument.pages ? ` · ${selectedDocument.pages} pages` : ""}</small></span></div>
              <button type="button" aria-label="Close document preview" onClick={() => setSelectedDocumentId(null)}><X size={18} /></button>
            </header>
            <div className="case-document-canvas">
              <section className="case-document-page">
                <div className="case-document-letterhead"><strong>{productName}</strong><span>Assessment supporting documentation</span></div>
                {selectedDocument.sections.map((section, index) => (
                  <div className="case-document-section" key={`${selectedDocument.id}-${index}`}>
                    {section.heading && <h3>{section.heading}</h3>}
                    {section.lines && <dl>{section.lines.map((line) => <div key={line.label} className={line.emphasis ? "emphasis" : ""}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl>}
                    {section.table && <div className="case-document-table-scroll"><table><thead><tr>{section.table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{section.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
                    {section.note && <p className="case-document-note">{section.note}</p>}
                  </div>
                ))}
              </section>
            </div>
          </article>
        </div>
      )}

      <footer className="case-taskbar" aria-label="Case applications">
        <button type="button" aria-label={productName} title={productName} onClick={() => { setOpenApp(null); setSelectedDocumentId(null); }}><Monitor size={18} /></button>
        <button className={openApp === "mail" ? "active" : ""} type="button" aria-label="Mail" title="Mail" onClick={() => openDeskApp("mail")}><Mail size={18} />{unreadCount > 0 && <em>{unreadCount}</em>}</button>
        <button className={openApp === "files" ? "active" : ""} type="button" aria-label="Documents" title="Documents" onClick={() => openDeskApp("files")}><FolderOpen size={18} /></button>
        <span className="case-taskbar-app-name">{productName}</span>
        <div className="case-taskbar-system"><Wifi size={14} /><Volume2 size={14} /><time>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
      </footer>
    </>
  );
}
