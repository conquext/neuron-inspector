import type { WebSocket } from "ws";

interface PendingEntry {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingCalls {
  private pending = new Map<string, PendingEntry>();

  call(
    ws: WebSocket,
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 10000,
  ): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tool call "${name}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      ws.send(JSON.stringify({
        type: "TOOL_CALL",
        requestId: id,
        payload: { name, args },
      }));
    });
  }

  onResponse(msg: { requestId: string; payload?: unknown; error?: string }): boolean {
    const entry = this.pending.get(msg.requestId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(msg.requestId);

    if (msg.error) {
      entry.reject(new Error(msg.error));
    } else {
      entry.resolve(msg.payload);
    }
    return true;
  }

  get size(): number {
    return this.pending.size;
  }

  clear(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Connection closed"));
    }
    this.pending.clear();
  }
}
