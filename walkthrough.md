# Walkthrough - Window Close Event Interception & Updated v1.0.6 Release

We have implemented **Window Close Event Interception** (`onCloseRequested`), re-tested all 90 tests, recompiled the `v1.0.6` production installers, and updated the GitHub release.

---

## 1. Application Shutdown Interception (`src/App.tsx`)

### How It Works
- Listens for Tauri window close requests (`onCloseRequested`) when the user clicks the application `X` titlebar button or presses `Alt+F4`.
- If any open tab has unsaved changes (`isDirty === true`):
  1. The window shutdown event is **paused immediately** (`event.preventDefault()`).
  2. The application automatically switches focus to the dirty tab.
  3. The **Unsaved Changes Confirmation Modal** (**Save**, **Don't Save**, **Cancel**) is displayed.
  4. If multiple tabs are dirty, selecting **Save** or **Don't Save** processes the current tab and moves to the next dirty tab sequentially.
  5. Once all dirty tabs are resolved, the application window closes cleanly.
  6. Clicking **Cancel** at any time stops the shutdown sequence and keeps the window open.

---

## 2. Automated Test Results

- **Unit Tests:**
  - `npm test`: **90 / 90 tests passed**.
  - `cargo test`: **22 / 22 Rust tests passed**.

---

## 3. GitHub & Production Installers (`v1.0.6`)

- **GitHub Release Tag:** `v1.0.6` (Updated and pushed to [alimozaffari-stack/markdown-editor](https://github.com/alimozaffari-stack/markdown-editor))
- **MSI Installer Package:**  
  `D:\Apps\markdown-editor\src-tauri\target\release\bundle\msi\Markdown Editor_1.0.6_x64_en-US.msi`
- **NSIS Setup Installer:**  
  `D:\Apps\markdown-editor\src-tauri\target\release\bundle\nsis\Markdown Editor_1.0.6_x64-setup.exe`
