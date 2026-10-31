export interface HistoryEntry {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

export class UndoRedoManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly limit: number;
  private readonly onChange: () => void;

  constructor(onChange: () => void, limit = 60) {
    this.onChange = onChange;
    this.limit = limit;
  }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? "";
  }

  redoLabel(): string {
    return this.redoStack[this.redoStack.length - 1]?.label ?? "";
  }

  async undo(): Promise<boolean> {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    await entry.undo();
    this.redoStack.push(entry);
    this.onChange();
    return true;
  }

  async redo(): Promise<boolean> {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    await entry.redo();
    this.undoStack.push(entry);
    this.onChange();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }
}
