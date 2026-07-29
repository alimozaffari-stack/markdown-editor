import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "../ui";
import { GithubIcon } from "../icons";

export function AboutSettingsSection() {
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  const handleOpenUrl = async (url: string) => {
    try {
      await invoke("open_url_safe", { url });
    } catch (err) {
      console.error("Failed to open URL:", err);
      toast.error(err instanceof Error ? err.message : "Failed to open URL");
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* Version */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Version</h2>
        <p className="text-sm text-text-muted mb-4">
          You are currently using Markdown Editor v{appVersion || "..."}
        </p>
        <p className="text-sm text-text-muted">
          Automatic updates are disabled for this independent edition. Install
          releases only from its GitHub repository.
        </p>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* About Section */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-1">About Markdown Editor</h2>
        <p className="text-sm text-text-muted mb-4">
          Markdown Editor is an offline-first Markdown editor for writing and
          working with documents. It is keyboard-optimised,
          AI-compatible, and open source with no cloud, no accounts, and no
          subscriptions. View this independent edition on{" "}
          <button
            onClick={() =>
              handleOpenUrl("https://github.com/alimozaffari-stack/markdown-editor")
            }
            className="text-text-muted border-b border-text-muted/50 hover:text-text hover:border-text cursor-pointer transition-colors"
          >
            GitHub
          </button>
          .
        </p>
        <p className="text-sm text-text-muted mb-4">
          Originally created by{" "}
          <button
            onClick={() => handleOpenUrl("https://ericli.io")}
            className="text-text-muted border-b border-text-muted/50 hover:text-text hover:border-text cursor-pointer transition-colors"
          >
            Eric Li
          </button>{" "}
          and extended here as an independently maintained edition. Upstream
          and contributor attribution is preserved.
        </p>
        <div className="flex items-center gap-1">
          <Button
            onClick={() =>
              handleOpenUrl("https://github.com/alimozaffari-stack/markdown-editor")
            }
            variant="outline"
            size="md"
            className="gap-1.25"
          >
            <GithubIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            View on GitHub
          </Button>
          <Button
            onClick={() =>
              handleOpenUrl(
                "https://github.com/alimozaffari-stack/markdown-editor/issues",
              )
            }
            variant="ghost"
            size="md"
            className="gap-1.25 text-text"
          >
            Submit Feedback
          </Button>
        </div>
      </section>
    </div>
  );
}
