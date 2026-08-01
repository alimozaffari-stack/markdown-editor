import React from "react";
import { FileExportIcon, XIcon, PlusIcon, ExternalLinkIcon } from "../icons";
import { Tooltip } from "../ui";

export interface TabItem {
  id: string;
  title: string;
  path?: string;
  isExternal: boolean;
  isDirty?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, event: React.MouseEvent) => void;
  onNewTab?: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center h-9 bg-bg-muted/40 border-b border-border/40 px-2 gap-1 overflow-x-auto select-none no-scrollbar">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group relative flex items-center gap-1.5 h-7 px-2.5 max-w-[200px] min-w-[110px] text-xs rounded-t-md border-t border-x transition-all cursor-pointer ${
                isActive
                  ? "bg-bg border-border/60 text-text font-medium shadow-2xs z-10"
                  : "bg-bg-muted/20 border-transparent text-text-muted hover:bg-bg-muted/60 hover:text-text"
              }`}
            >
              {tab.isExternal ? (
                <ExternalLinkIcon className="w-3.5 h-3.5 shrink-0 text-amber-500 stroke-[1.8]" />
              ) : (
                <FileExportIcon className="w-3.5 h-3.5 shrink-0 text-text-muted stroke-[1.8]" />
              )}
              <span className="truncate flex-1" title={tab.path || tab.title}>
                {tab.title}
              </span>
              {tab.isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onCloseTab(tab.id, e);
                }}
                className={`p-0.5 rounded-sm hover:bg-bg-emphasis text-text-muted hover:text-text transition-colors opacity-0 group-hover:opacity-100 ${
                  isActive ? "opacity-70" : ""
                }`}
                title="Close tab"
              >
                <XIcon className="w-3 h-3 stroke-[2]" />
              </button>
            </div>
          );
        })}
      </div>
      {onNewTab && (
        <Tooltip content="New Note">
          <button
            onClick={onNewTab}
            className="p-1 text-text-muted hover:text-text hover:bg-bg-emphasis rounded-md transition-colors shrink-0"
          >
            <PlusIcon className="w-4 h-4 stroke-[1.8]" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
