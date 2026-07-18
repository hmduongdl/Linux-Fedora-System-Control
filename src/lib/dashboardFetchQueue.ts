type FetchTask = () => void | Promise<void>;

interface RecurringTask {
  task: FetchTask;
  cadenceTicks: number;
  registeredAtTick: number;
  token: symbol;
  lastQueuedAt: number;
  deferMs?: () => number;
}

interface RegisterOptions {
  cadenceTicks?: number;
  runInitially?: boolean;
  /** Stagger the first request so page rendering is never competing with it. */
  initialDelayMs?: number;
  /** Extend the interval dynamically, useful while a game owns resources. */
  deferMs?: () => number;
}

interface DeferredRun {
  timer: ReturnType<typeof globalThis.setTimeout>;
  token: symbol;
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
  private readonly deferred = new Map<string, DeferredRun>();
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
      lastQueuedAt: Date.now(),
      deferMs: options.deferMs,
    });

    // The first load can be staggered by cost. Later refreshes remain aligned
    // to the shared 10-second tick and run as one concurrent batch.
    let initialTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    if (options.runInitially === false) {
      // The first run will be produced by the normal scheduler tick.
    } else if (initialDelayMs === 0) {
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
      const deferred = this.deferred.get(key);
      if (deferred?.token === token) {
        globalThis.clearTimeout(deferred.timer);
        this.deferred.delete(key);
      }
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
        if (!entry.deferMs) {
          this.pending.set(key, entry.task);
        } else if (!this.deferred.has(key)) {
          // Extend the real interval instead of only shifting every fixed tick.
          const nextRunAt = entry.lastQueuedAt + DEFAULT_TICK_MS + this.getDeferMs(entry);
          const waitMs = Math.max(0, nextRunAt - Date.now());
          const timer = globalThis.setTimeout(() => {
            this.deferred.delete(key);
            const current = this.recurring.get(key);
            if (current?.token !== entry.token) return;
            current.lastQueuedAt = Date.now();
            this.pending.set(key, current.task);
            this.scheduleDrain();
          }, waitMs);
          this.deferred.set(key, { timer, token: entry.token });
        }
      }
    }
    this.scheduleDrain();
  }

  private getDeferMs(entry: RecurringTask) {
    if (!entry.deferMs) return 0;
    try {
      return Math.max(0, Math.round(entry.deferMs()));
    } catch (error) {
      console.error("[dashboard-fetch] unable to calculate deferred delay", error);
      return 0;
    }
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
