type FetchTask = () => void | Promise<void>;

interface RecurringTask {
  task: FetchTask;
  cadenceTicks: number;
  registeredAtTick: number;
  token: symbol;
}

interface RegisterOptions {
  cadenceTicks?: number;
  /** Stagger the first request so page rendering is never competing with it. */
  initialDelayMs?: number;
}

const DEFAULT_TICK_MS = 10_000;

/**
 * Coalesces dashboard reads into one concurrent batch per scheduler tick.
 * A task key can have at most one request in flight; repeated requests while
 * it is busy are reduced to one pending run instead of piling up IPC calls.
 */
class DashboardFetchQueue {
  private readonly recurring = new Map<string, RecurringTask>();
  private readonly pending = new Map<string, FetchTask>();
  private readonly inFlight = new Set<string>();
  private timer: ReturnType<typeof globalThis.setInterval> | null = null;
  private tick = 0;
  private drainScheduled = false;

  enqueue(key: string, task: FetchTask) {
    this.pending.set(key, task);
    this.scheduleDrain();
  }

  register(key: string, task: FetchTask, options: RegisterOptions = {}) {
    const cadenceTicks = Math.max(1, Math.floor(options.cadenceTicks ?? 1));
    const initialDelayMs = Math.max(0, options.initialDelayMs ?? 0);
    const token = Symbol(key);
    this.recurring.set(key, {
      task,
      cadenceTicks,
      registeredAtTick: this.tick,
      token,
    });

    // The first load can be staggered by cost. Later refreshes remain aligned
    // to the shared 10-second tick and run as one concurrent batch.
    let initialTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    if (initialDelayMs === 0) {
      this.enqueue(key, task);
    } else {
      initialTimer = globalThis.setTimeout(() => {
        initialTimer = null;
        if (this.recurring.get(key)?.token === token) this.enqueue(key, task);
      }, initialDelayMs);
    }
    this.ensureTimer();

    return () => {
      if (initialTimer !== null) globalThis.clearTimeout(initialTimer);
      const current = this.recurring.get(key);
      if (current?.token !== token) return;
      this.recurring.delete(key);
      this.pending.delete(key);
      if (this.recurring.size === 0 && this.timer !== null) {
        globalThis.clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private ensureTimer() {
    if (this.timer !== null) return;
    this.timer = globalThis.setInterval(() => this.queueTick(), DEFAULT_TICK_MS);
  }

  private queueTick() {
    this.tick += 1;
    for (const [key, entry] of this.recurring) {
      if ((this.tick - entry.registeredAtTick) % entry.cadenceTicks === 0) {
        this.pending.set(key, entry.task);
      }
    }
    this.scheduleDrain();
  }

  private scheduleDrain() {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private drain() {
    // Start all ready jobs together, while preserving a per-key in-flight lock.
    const batch = [...this.pending].filter(([key]) => !this.inFlight.has(key));
    for (const [key, task] of batch) {
      this.pending.delete(key);
      this.inFlight.add(key);
      void Promise.resolve()
        .then(task)
        .catch((error) => console.error(`[dashboard-fetch:${key}]`, error))
        .finally(() => this.inFlight.delete(key));
    }
  }
}

export const dashboardFetchQueue = new DashboardFetchQueue();
