import { Copy, Maximize2, Minimize2, Pencil, Save, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type DocumentPreviewData =
  | { kind: "text" | "markdown"; text: string; truncated: boolean }
  | { kind: "word"; html: string; messages: string[] }
  | { kind: "excel"; sheets: { name: string; rows: string[][] }[]; maxRows: number; maxCols: number };

interface DocumentPreviewProps {
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  readonly isFullscreen: boolean;
  readonly documentPreviewStatus: "idle" | "loading" | "error";
  readonly documentPreview: DocumentPreviewData | null;
  readonly documentTypeLabel: string;
  readonly isEditingDocument: boolean;
  readonly saveStatus: "idle" | "saving" | "error";
  readonly canEdit: boolean;
  readonly isEditableDocument: boolean;
  readonly hasDocumentEdits: boolean;
  readonly editorText: string;
  readonly onEditorTextChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  readonly activeSheetIndex: number;
  readonly onActiveSheetIndexChange: (index: number) => void;
  readonly onToggleFullscreen: () => void;
  readonly onCloseFullscreen: () => void;
  readonly onStartEditing: () => void;
  readonly onCancelEditing: () => void;
  readonly onSave: () => void;
}

export function DocumentPreview({
  scrollRef,
  isFullscreen,
  documentPreviewStatus,
  documentPreview,
  documentTypeLabel,
  isEditingDocument,
  saveStatus,
  canEdit,
  isEditableDocument,
  hasDocumentEdits,
  editorText,
  onEditorTextChange,
  activeSheetIndex,
  onActiveSheetIndexChange,
  onToggleFullscreen,
  onCloseFullscreen,
  onStartEditing,
  onCancelEditing,
  onSave,
}: Readonly<DocumentPreviewProps>) {
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const textBody =
    documentPreview?.kind === "text" || documentPreview?.kind === "markdown"
      ? isEditingDocument
        ? editorText
        : documentPreview.text
      : "";

  const canCopyContent =
    isEditableDocument &&
    documentPreviewStatus !== "loading" &&
    Boolean(textBody) &&
    !(documentPreview?.kind === "text" || documentPreview?.kind === "markdown"
      ? documentPreview.truncated
      : false);

  const handleCopyContent = useCallback(async () => {
    if (!canCopyContent || !textBody) return;
    try {
      await navigator.clipboard.writeText(textBody);
      setCopyToast("Copied");
    } catch {
      setCopyToast("Couldn't copy");
    }
  }, [canCopyContent, textBody]);

  useEffect(() => {
    if (!copyToast) return;
    const timer = window.setTimeout(() => setCopyToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copyToast]);

  // Ctrl/Cmd+Shift+C — does not steal normal select-copy (Ctrl/Cmd+C)
  useEffect(() => {
    if (!isEditableDocument) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "c") return;
      e.preventDefault();
      void handleCopyContent();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isEditableDocument, handleCopyContent]);

  return (
    <div
      ref={scrollRef}
      className={`w-full h-full overflow-auto bg-background text-foreground ${
        isFullscreen ? "" : "max-h-[40vh] md:max-h-[90vh]"
      }`}
    >
      {(documentPreview || (isEditableDocument && documentPreviewStatus === "loading")) && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/20 bg-background/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {documentPreviewStatus === "loading"
                ? `Loading ${documentTypeLabel}…`
                : `${isEditingDocument ? "Editing" : "Previewing"} ${documentTypeLabel}`}
              {isFullscreen && documentPreviewStatus !== "loading" ? " — fullscreen" : ""}
            </p>
            {saveStatus === "error" && <p className="text-xs text-red-400 mt-0.5">Could not save changes</p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            title={isFullscreen ? "Exit fullscreen" : "View fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
          </button>
          {isFullscreen && (
            <button
              type="button"
              onClick={onCloseFullscreen}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Copy: open text viewer only — same row/weight as Edit; hidden when binary/oversize/error */}
          {isEditableDocument && documentPreviewStatus !== "error" && (
            <button
              type="button"
              onClick={() => void handleCopyContent()}
              disabled={!canCopyContent}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-xs text-foreground hover:bg-accent transition-all disabled:opacity-50 disabled:pointer-events-none"
              title="Copy content (Ctrl/⌘⇧C)"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
          )}
          {canEdit && isEditableDocument && documentPreview && (
            <div className="flex flex-wrap justify-end gap-2">
              {isEditingDocument ? (
                <>
                  <button
                    type="button"
                    onClick={onCancelEditing}
                    className="px-3 py-1.5 rounded-lg border border-border/30 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={!hasDocumentEdits || saveStatus === "saving"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary text-[#060e20] text-xs font-semibold disabled:opacity-50 transition-opacity"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saveStatus === "saving" ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onStartEditing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-xs text-foreground hover:bg-accent transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
              )}
            </div>
          )}
          </div>
        </div>
      )}
      {documentPreviewStatus === "loading" && (
        <div className="h-full min-h-[260px] flex items-center justify-center text-sm text-muted-foreground">
          Loading preview…
        </div>
      )}
      {documentPreviewStatus === "error" && (
        <div className="h-full min-h-[260px] flex items-center justify-center text-sm text-muted-foreground">
          Preview could not be loaded
        </div>
      )}
      <div className="p-5">
      {documentPreview?.kind === "text" && isEditingDocument && (
        <textarea
          value={editorText}
          onChange={onEditorTextChange}
          className="min-h-[360px] w-full resize-y rounded-xl border border-border/30 bg-muted/20 p-4 font-mono text-sm leading-6 text-foreground outline-hidden focus:border-brand-primary/70 focus:ring-2 focus:ring-brand-primary/20"
          spellCheck={false}
        />
      )}
      {documentPreview?.kind === "text" && !isEditingDocument && (
        <pre className="whitespace-pre-wrap break-words text-sm leading-6 font-mono">{documentPreview.text}</pre>
      )}
      {documentPreview?.kind === "markdown" && isEditingDocument && (
        <textarea
          value={editorText}
          onChange={onEditorTextChange}
          className="min-h-[360px] w-full resize-y rounded-xl border border-border/30 bg-muted/20 p-4 font-mono text-sm leading-6 text-foreground outline-hidden focus:border-brand-primary/70 focus:ring-2 focus:ring-brand-primary/20"
          spellCheck={false}
        />
      )}
      {documentPreview?.kind === "markdown" && !isEditingDocument && (
        <div className="text-sm leading-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{documentPreview.text}</ReactMarkdown>
        </div>
      )}
      {documentPreview?.kind === "word" && (
        <div
          className="text-sm leading-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          dangerouslySetInnerHTML={{ __html: documentPreview.html }}
        />
      )}
      {documentPreview?.kind === "excel" && (
        <div className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {documentPreview.sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                type="button"
                onClick={() => onActiveSheetIndexChange(index)}
                className={`px-3 py-1.5 rounded-lg text-xs shrink-0 ${
                  activeSheetIndex === index ? "bg-brand-primary text-[#060e20]" : "bg-muted text-muted-foreground"
                }`}
              >
                {sheet.name}
              </button>
            ))}
          </div>
          <div className="overflow-auto rounded-xl border border-border/20">
            <table className="min-w-full border-collapse text-xs">
              <tbody>
                {(documentPreview.sheets[activeSheetIndex]?.rows ?? []).map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex === 0 ? "bg-muted/70" : "odd:bg-muted/20"}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border border-border/10 px-2 py-1.5 max-w-[220px] truncate">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {copyToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient">
          <span className="text-xs text-foreground whitespace-nowrap">{copyToast}</span>
          <button
            type="button"
            onClick={() => setCopyToast(null)}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
