import { getSnapshot } from "./get-snapshot.js";
import { HistoryStack } from "./history-stack.js";
import { restoreSnapshot } from "./restore-snapshot.js";

export interface Snapshot {
  documentHtml: string;
  cursorLineIndex: number;
  cursorLineOffset: number;
}

const compareSnapshots = (a: Snapshot | null, b: Snapshot | null) => {
  return (
    a?.documentHtml === b?.documentHtml &&
    a?.cursorLineIndex === b?.cursorLineIndex &&
    a?.cursorLineOffset === b?.cursorLineOffset
  );
};

export class HistoryService {
  private stack = new HistoryStack<Snapshot>();

  save(root: HTMLElement) {
    const snapshot = getSnapshot(root);
    const current = this.stack.peek();

    if (compareSnapshots(current, snapshot)) {
      return;
    }

    this.stack.push(snapshot);
  }

  undo(root: HTMLElement) {
    // if a newer version isn't available, try save current version and undo it.
    if (this.stack.length === 1) {
      this.save(root);
    }

    const snapshot = this.stack.undo();

    if (snapshot) {
      restoreSnapshot(snapshot, root);
    }
  }

  redo(root: HTMLElement) {
    const snapshot = this.stack.redo();
    if (!snapshot) return;

    restoreSnapshot(snapshot, root);
  }

  peek() {
    return this.stack.peek();
  }
}

export const historyService = new HistoryService();
(window as any).s2 = {
  ...(window as any).s2,
  history: historyService,
};
