import { Button } from "../ui";

interface UnsavedChangesModalProps {
  open: boolean;
  fileName: string;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

export function UnsavedChangesModal({
  open,
  fileName,
  onSave,
  onDontSave,
  onCancel,
}: UnsavedChangesModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs animate-fade-in">
      <div className="bg-bg border border-border rounded-xl shadow-2xl p-6 w-full max-w-md animate-scale-in">
        <h3 className="text-lg font-semibold text-text mb-2">
          Save changes to "{fileName}"?
        </h3>
        <p className="text-sm text-text-muted mb-6">
          Your edits will be lost if you don't save them.
        </p>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <button
            onClick={onDontSave}
            className="h-8 px-3 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-md border border-red-500/30 transition-colors cursor-pointer"
          >
            Don't Save
          </button>
          <Button variant="primary" size="sm" onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
