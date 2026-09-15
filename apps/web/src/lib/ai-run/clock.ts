/**
 * Where time comes from.
 *
 * Behind an interface for one reason: the executor is the part of this feature most worth testing,
 * and a test that has to wait 18 real seconds to find out what a run does is a test nobody runs.
 * `manualClock` advances by hand, so the whole of a redesign can be asserted frame by frame in
 * milliseconds — and the browser implementation stays four lines with nothing to be wrong about.
 */

export interface Clock {
  /** Monotonic milliseconds. Never a wall clock: a run must not skip when the system time moves. */
  now(): number;
  /** Schedules one callback for the next frame. Returns its canceller. */
  frame(callback: (now: number) => void): () => void;
}

export function browserClock(): Clock {
  return {
    now: () => performance.now(),
    frame: (callback) => {
      const handle = requestAnimationFrame(() => callback(performance.now()));
      return () => cancelAnimationFrame(handle);
    },
  };
}

export interface ManualClock extends Clock {
  /** Moves time on and runs whatever was waiting for a frame, in the order it was requested. */
  advance(ms: number): void;
  /** Runs the pending frame callbacks without moving time. */
  flush(): void;
}

export function manualClock(start = 0): ManualClock {
  let current = start;
  let pending: ((now: number) => void)[] = [];

  const flush = () => {
    const due = pending;
    pending = [];
    for (const callback of due) callback(current);
  };

  return {
    now: () => current,
    frame: (callback) => {
      pending.push(callback);
      return () => {
        pending = pending.filter((waiting) => waiting !== callback);
      };
    },
    advance: (ms) => {
      current += ms;
      flush();
    },
    flush,
  };
}
