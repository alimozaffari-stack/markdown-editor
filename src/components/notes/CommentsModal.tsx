import { useState, useMemo, useCallback, useEffect } from "react";
import { useNotes } from "../../context/NotesContext";
import { cleanTitle } from "../../lib/utils";
import { TrashIcon } from "../icons";

export function CommentsModal() {
  const {
    notes,
    commentsMap,
    activeCommentsNoteId,
    activeCommentsInitialText,
    setActiveCommentsNoteId,
    addComment,
    deleteComment,
  } = useNotes();

  const [newCommentText, setNewCommentText] = useState("");

  useEffect(() => {
    if (activeCommentsNoteId) {
      setNewCommentText(activeCommentsInitialText || "");
    }
  }, [activeCommentsNoteId, activeCommentsInitialText]);

  const activeNote = useMemo(() => {
    if (!activeCommentsNoteId) return null;
    return notes.find((n) => n.id === activeCommentsNoteId) || null;
  }, [notes, activeCommentsNoteId]);

  const comments = useMemo(() => {
    if (!activeCommentsNoteId) return [];
    return commentsMap[activeCommentsNoteId] || [];
  }, [commentsMap, activeCommentsNoteId]);

  const handleClose = useCallback(() => {
    setActiveCommentsNoteId(null);
    setNewCommentText("");
  }, [setActiveCommentsNoteId]);

  const handleAdd = useCallback(async () => {
    if (!activeCommentsNoteId || !newCommentText.trim()) return;
    await addComment(activeCommentsNoteId, newCommentText.trim());
    setNewCommentText("");
  }, [activeCommentsNoteId, newCommentText, addComment]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleAdd();
      }
    },
    [handleAdd]
  );

  const handleExportComments = useCallback(() => {
    if (!activeNote || comments.length === 0) return;

    const title = cleanTitle(activeNote.title);
    const contentLines = [
      `# Comments on: ${title}`,
      `Document ID: ${activeNote.id}`,
      `Exported: ${new Date().toLocaleString()}`,
      "",
      "---",
      "",
    ];

    comments.forEach((comment, idx) => {
      const dateStr = new Date(comment.timestamp * 1000).toLocaleString();
      contentLines.push(`### Comment #${idx + 1}`);
      contentLines.push(`**Date:** ${dateStr}`);
      contentLines.push(`**Text:**`);
      contentLines.push(comment.text);
      contentLines.push("");
      contentLines.push("---");
      contentLines.push("");
    });

    const blob = new Blob([contentLines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-comments.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeNote, comments]);

  if (!activeCommentsNoteId || !activeNote) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-text/30 backdrop-blur-sm transition-opacity duration-300"
        onClick={handleClose}
      />

      {/* Dialog box */}
      <div className="relative bg-bg border border-border w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden z-10 animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex flex-col min-w-0">
            <h2 className="text-base font-semibold text-text truncate">
              Comments
            </h2>
            <p className="text-xs text-text-muted truncate">
              {cleanTitle(activeNote.title)}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-text p-1 rounded-md hover:bg-bg-muted transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-[200px]">
          {comments.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-8">
              <div className="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center mb-3">
                <svg
                  className="w-6 h-6 text-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.023 10.12 10.12 0 01-1.914-4.63C4.03 16.556 8 21 12 21M3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-text">No comments yet</p>
              <p className="text-xs text-text-muted max-w-[280px] mt-1">
                Add your first timestamped comment below to track notes or share annotations.
              </p>
            </div>
          ) : (
            comments.map((comment) => {
              const dateStr = new Date(comment.timestamp * 1000).toLocaleString();
              return (
                <div
                  key={comment.id}
                  className="group flex gap-3 p-3 bg-bg-muted/30 border border-border/50 hover:border-border rounded-lg transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text whitespace-pre-wrap break-words leading-relaxed select-text">
                      {comment.text}
                    </p>
                    <span className="text-[10px] font-mono text-text-muted mt-1.5 block">
                      {dateStr}
                    </span>
                  </div>
                  <button
                    onClick={() => void deleteComment(activeCommentsNoteId, comment.id)}
                    className="self-start text-text-muted hover:text-red-500 p-1.5 rounded-md hover:bg-bg-muted/50 transition-colors cursor-pointer"
                    title="Delete comment"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Input box */}
        <div className="p-4 border-t border-border bg-bg-muted/20 space-y-3">
          <div className="flex gap-2">
            <textarea
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a comment..."
              rows={2}
              className="flex-1 min-w-0 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted/60 focus:outline-none focus:ring-1 focus:ring-border resize-none select-text"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            {comments.length > 0 ? (
              <button
                onClick={handleExportComments}
                className="text-xs text-text-muted hover:text-text flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-bg-muted transition-colors cursor-pointer font-medium"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Export Comments
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text font-medium rounded-md hover:bg-bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!newCommentText.trim()}
                className="px-4 py-1.5 text-xs bg-text text-bg hover:bg-text-muted disabled:opacity-40 font-semibold rounded-md transition-colors cursor-pointer"
              >
                Add Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
