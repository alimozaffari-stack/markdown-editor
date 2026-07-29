import { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "../../lib/utils";
import { useOptionalNotes } from "../../context/NotesContext";

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

interface TableOfContentsProps {
  editor: Editor | null;
  sourceMode: boolean;
  sourceContent: string;
}

export function TableOfContents({
  editor,
  sourceMode,
  sourceContent,
}: TableOfContentsProps) {
  const [isExpanded, setIsExpanded] = useState(() => {
    const saved = localStorage.getItem("markdown-editor:tocExpanded");
    return saved !== "false";
  });

  const [activeTab, setActiveTab] = useState<"outline" | "footnotes">("outline");
  const [headings, setHeadings] = useState<HeadingItem[]>([]);

  const notesCtx = useOptionalNotes();
  const currentNote = notesCtx?.currentNote ?? null;
  const footnotesMap = notesCtx?.footnotesMap ?? {};
  const updateFootnote = notesCtx?.updateFootnote;
  const deleteFootnote = notesCtx?.deleteFootnote;

  const currentFootnotes = currentNote ? footnotesMap[currentNote.id] || [] : [];

  // Toggle outline expansion
  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("markdown-editor:tocExpanded", String(next));
      return next;
    });
  }, []);

  // Listen for focus footnote or toggle toc event from editor / command palette interaction
  useEffect(() => {
    const handleFootnote = (e: Event) => {
      const customEvent = e as CustomEvent<{ label: string }>;
      const label = customEvent.detail?.label;
      if (label) {
        setActiveTab("footnotes");
        setIsExpanded(true);
        setTimeout(() => {
          const el = document.getElementById(`footnote-card-${label}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            el.classList.add("bg-accent/15", "border-accent/30");
            setTimeout(() => {
              el.classList.remove("bg-accent/15", "border-accent/30");
            }, 1500);
          }
        }, 150);
      }
    };

    const handleToggleToc = () => {
      setIsExpanded((prev) => {
        const next = !prev;
        localStorage.setItem("markdown-editor:tocExpanded", String(next));
        return next;
      });
    };

    window.addEventListener("editor:focus-footnote", handleFootnote);
    window.addEventListener("editor:toggle-toc", handleToggleToc);
    return () => {
      window.removeEventListener("editor:focus-footnote", handleFootnote);
      window.removeEventListener("editor:toggle-toc", handleToggleToc);
    };
  }, []);

  // Sync headings from Editor or SourceContent
  useEffect(() => {
    if (sourceMode) {
      const parsedHeadings: HeadingItem[] = [];
      const headingRegex = /^(#{1,6})\s+(.+)$/gm;
      let match;
      let index = 0;
      
      headingRegex.lastIndex = 0;
      while ((match = headingRegex.exec(sourceContent)) !== null) {
        const level = match[1].length;
        const text = match[2].trim();
        parsedHeadings.push({
          id: `src-heading-${index}`,
          level,
          text,
          pos: match.index,
        });
        index++;
      }
      setHeadings(parsedHeadings);
    } else {
      if (!editor) return;

      const extractHeadings = () => {
        const parsedHeadings: HeadingItem[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "heading") {
            parsedHeadings.push({
              id: `editor-heading-${pos}`,
              level: node.attrs.level,
              text: node.textContent,
              pos,
            });
          }
        });
        queueMicrotask(() => {
          setHeadings(parsedHeadings);
        });
      };

      extractHeadings();

      editor.on("update", extractHeadings);
      editor.on("selectionUpdate", extractHeadings);

      return () => {
        editor.off("update", extractHeadings);
        editor.off("selectionUpdate", extractHeadings);
      };
    }
  }, [editor, sourceMode, sourceContent]);

  // Handle heading click scroll
  const handleHeadingClick = useCallback(
    (heading: HeadingItem) => {
      if (sourceMode) {
        const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(heading.pos, heading.pos + heading.text.length);
          
          const lineNum = sourceContent.substring(0, heading.pos).split("\n").length;
          const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20");
          textarea.scrollTop = (lineNum - 5) * lineHeight;
        }
      } else {
        if (!editor) return;
        editor.chain().focus().setTextSelection(heading.pos).scrollIntoView().run();
      }
    },
    [editor, sourceMode, sourceContent]
  );

  // Jump to specific footnote reference in text
  const handleGoToFootnote = useCallback(
    (id: string) => {
      if (sourceMode) {
        const marker = `[^${id}]`;
        const index = sourceContent.indexOf(marker);
        if (index !== -1) {
          const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
          if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(index, index + marker.length);
            const lineNum = sourceContent.substring(0, index).split("\n").length;
            const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20");
            textarea.scrollTop = (lineNum - 5) * lineHeight;
          }
        }
      } else {
        if (!editor) return;
        let foundPos: number | null = null;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "footnoteReference" && node.attrs.label === id) {
            foundPos = pos;
            return false;
          }
        });
        if (foundPos !== null) {
          editor.chain().focus().setTextSelection(foundPos).scrollIntoView().run();
        }
      }
    },
    [editor, sourceMode, sourceContent]
  );

  const handleAddFootnote = () => {
    window.dispatchEvent(new CustomEvent("editor:insert-footnote"));
  };

  return (
    <div
      className={cn(
        "border-l border-border bg-bg-secondary/20 flex flex-col transition-all duration-300 relative select-none shrink-0",
        isExpanded ? "w-64" : "w-10"
      )}
    >
      {/* Toggle Button */}
      <button
        onClick={toggleExpand}
        className={cn(
          "absolute top-3 left-2.5 z-10 p-1.5 rounded-md text-text-muted hover:text-text hover:bg-bg-muted transition-colors cursor-pointer",
          isExpanded ? "left-auto right-3" : ""
        )}
        title={isExpanded ? "Collapse Sidebar" : "Expand Sidebar"}
        aria-label="Toggle Sidebar"
      >
        {isExpanded ? (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        ) : (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
          </svg>
        )}
      </button>

      {isExpanded ? (
        <div className="flex-1 flex flex-col overflow-hidden p-4 pt-14">
          {/* Navigation Tabs */}
          <div className="flex border-b border-border mb-4">
            <button
              onClick={() => setActiveTab("outline")}
              className={cn(
                "flex-1 text-center pb-2 text-[11px] font-semibold tracking-wider uppercase border-b-2 transition-all cursor-pointer",
                activeTab === "outline"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              Outline
            </button>
            <button
              onClick={() => setActiveTab("footnotes")}
              className={cn(
                "flex-1 text-center pb-2 text-[11px] font-semibold tracking-wider uppercase border-b-2 transition-all cursor-pointer",
                activeTab === "footnotes"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              Footnotes
              {currentFootnotes.length > 0 && (
                <span className="ml-1.5 px-1 py-0.2 rounded-full text-[9px] bg-accent/10 text-accent font-bold">
                  {currentFootnotes.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab Contents */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === "outline" ? (
              <div className="flex-1 overflow-y-auto pr-1 space-y-1 scrollbar-thin">
                {headings.length === 0 ? (
                  <p className="text-xs text-text-muted/60 italic py-2">
                    No headings found. Add headings (H1-H6) to populate outline.
                  </p>
                ) : (
                  headings.map((heading) => {
                    const indentClass =
                      heading.level === 1
                        ? "pl-0 font-medium text-text"
                        : heading.level === 2
                        ? "pl-3 text-text/80"
                        : heading.level === 3
                        ? "pl-6 text-text-muted"
                        : heading.level === 4
                        ? "pl-9 text-text-muted/80 text-[11px]"
                        : heading.level === 5
                        ? "pl-12 text-text-muted/70 text-[10.5px]"
                        : "pl-15 text-text-muted/50 text-[10px]";

                    return (
                      <button
                        key={heading.id}
                        onClick={() => handleHeadingClick(heading)}
                        className={cn(
                          "w-full text-left py-1 text-xs hover:text-text rounded transition-colors truncate block cursor-pointer hover:bg-bg-muted/40 px-1.5",
                          indentClass
                        )}
                        title={heading.text}
                      >
                        {heading.text}
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {!currentNote ? (
                  <p className="text-xs text-text-muted/60 italic py-2">
                    Open a note to view and manage footnotes.
                  </p>
                ) : (
                  <>
                    {/* Footnotes List */}
                    <div className="flex-1 overflow-y-auto pr-1 space-y-3 pb-4 scrollbar-thin">
                      {currentFootnotes.length === 0 ? (
                        <p className="text-xs text-text-muted/60 italic py-4 text-center">
                          No footnotes found in this note.
                        </p>
                      ) : (
                        currentFootnotes.map((fn) => (
                          <div
                            key={fn.id}
                            id={`footnote-card-${fn.id}`}
                            className="p-2 border border-border bg-bg-secondary/40 rounded-lg space-y-2 transition-all duration-300"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-accent font-mono bg-accent/5 px-1.5 py-0.5 rounded border border-accent/10">
                                [^{fn.id}]
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleGoToFootnote(fn.id)}
                                  className="p-1 rounded text-text-muted hover:text-text hover:bg-bg-muted transition-colors cursor-pointer"
                                  title="Find reference in text"
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"
                                    />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => deleteFootnote?.(currentNote.id, fn.id)}
                                  className="p-1 rounded text-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                  title="Delete footnote"
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <textarea
                              value={fn.text}
                              onChange={(e) =>
                                updateFootnote?.(currentNote.id, fn.id, e.target.value)
                              }
                              placeholder="Footnote explanation..."
                              className="w-full text-xs bg-bg border border-border rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-accent resize-none h-16 text-text"
                            />
                          </div>
                        ))
                      )}
                    </div>

                    {/* Add Footnote Button */}
                    <div className="pt-2 border-t border-border">
                      <button
                        onClick={handleAddFootnote}
                        className="w-full flex items-center justify-center py-2 px-3 bg-accent text-white rounded-md text-xs font-semibold hover:bg-accent/90 transition-colors cursor-pointer shadow-sm shadow-accent/10"
                      >
                        <svg
                          className="w-3.5 h-3.5 mr-1.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        Add Footnote
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center pt-14 space-y-6">
          <button
            onClick={() => {
              setActiveTab("outline");
              setIsExpanded(true);
            }}
            className={cn(
              "text-[10px] font-semibold tracking-widest uppercase transition-colors hover:text-text",
              activeTab === "outline" ? "text-accent" : "text-text-muted/50"
            )}
            style={{ writingMode: "vertical-rl" }}
          >
            Outline
          </button>
          <button
            onClick={() => {
              setActiveTab("footnotes");
              setIsExpanded(true);
            }}
            className={cn(
              "text-[10px] font-semibold tracking-widest uppercase transition-colors hover:text-text relative",
              activeTab === "footnotes" ? "text-accent" : "text-text-muted/50"
            )}
            style={{ writingMode: "vertical-rl" }}
          >
            Footnotes
            {currentFootnotes.length > 0 && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
