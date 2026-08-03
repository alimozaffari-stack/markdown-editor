import "./lib/tauri-mock";
import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";
import "./App.css";
import { rememberRecentExternalFile } from "./lib/recentExternalFiles";

function Root() {
  const [externalFilePath, setExternalFilePath] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const registerExternalFileListener = async () => {
      const disposeOpen = await listen<string>("open-external-file", (event) => {
        setExternalFilePath(event.payload);
        rememberRecentExternalFile(event.payload);
      });
      const disposeClose = await listen("close-external-file", () => {
        setExternalFilePath(null);
      });
      const dispose = () => {
        disposeOpen();
        disposeClose();
      };

      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;

      try {
        const path = await invoke<string | null>("get_open_external_file");
        if (!cancelled) {
          setExternalFilePath(path);
          if (path) rememberRecentExternalFile(path);
        }
      } catch (error) {
        console.error("Failed to resolve external file path:", error);
      }
    };

    void registerExternalFileListener();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <App
      externalFilePath={externalFilePath}
      onExitExternalFile={() => setExternalFilePath(null)}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
