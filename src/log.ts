import logUpdate from "log-update";

type ProgressLogger = {
  startTask(id: string, message: string): void;
  updateTask(id: string, message: string): void;
  finishTask(id: string, message: string): void;
  failTask(id: string, message: string): void;
  logOk(message: string): void;
  logInfo(message: string): void;
  logWarn(message: string): void;
  logError(message: string): void;
  stop(): void;
};

const COLOR = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

const isTty = Boolean(process.stdout.isTTY);
const SPINNER = ["|", "/", "-", "\\"];

export function logOk(message: string): void {
  console.log(`${COLOR.green}[OK]${COLOR.reset}      ${message}`);
}

export function logInfo(message: string): void {
  console.log(`${COLOR.blue}[INFO]${COLOR.reset}    ${message}`);
}

export function logWarn(message: string): void {
  console.log(`${COLOR.yellow}[WARN]${COLOR.reset}    ${message}`);
}

export function logError(message: string): void {
  console.log(`${COLOR.red}[ERROR]${COLOR.reset}   ${message}`);
}

export function createProgress(total: number): ProgressLogger {
  let current = 0;
  let lastMessage = "";
  let frameIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  const active = new Map<string, string>();
  const taskStarts = new Map<string, number>();
  const recent: string[] = [];
  const maxActive = 3;
  const maxRecent = 3;
  const startedAt = Date.now();

  function render(): void {
    if (!isTty) {
      return;
    }
    frameIndex = (frameIndex + 1) % SPINNER.length;
    const columns = process.stdout.columns ?? 80;
    const barWidth = Math.max(10, Math.min(30, columns - 40));
    const ratio = total === 0 ? 1 : current / total;
    const filled = Math.round(ratio * barWidth);
    const bar = `[${"=".repeat(filled)}${"-".repeat(barWidth - filled)}]`;
    const percent = String(Math.round(ratio * 100)).padStart(3, " ");
    const spinner = SPINNER[frameIndex] ?? "|";
    const elapsed = formatDuration(Date.now() - startedAt);
    const eta = formatEta(current, total, startedAt);
    const header = `${COLOR.dim}${spinner} [${current}/${total}]${COLOR.reset}`;
    const meta = `${COLOR.dim}Elapsed ${elapsed}${eta ? ` · ETA ${eta}` : ""}${COLOR.reset}`;
    const message = lastMessage ? ` ${lastMessage}` : "";
    const activeLines = Array.from(active.entries())
      .slice(0, maxActive)
      .map(([id, line]) => {
        const started = taskStarts.get(id);
        const duration = started ? formatDuration(Date.now() - started) : "";
        const suffix = duration ? `${COLOR.dim} (${duration})${COLOR.reset}` : "";
        return `  - ${line}${suffix}`;
      });
    const recentLines = recent.slice(0, maxRecent).map((line) => {
      return `  ${COLOR.dim}*${COLOR.reset} ${line}`;
    });
    const lines = [
      `${header} ${bar} ${percent}%${message}`,
      `  ${meta}`,
      ...activeLines,
      ...recentLines,
    ];
    logUpdate(lines.join("\n"));
  }

  function logLine(prefix: string, message: string): void {
    if (isTty) {
      logUpdate.clear();
    }
    console.log(`${prefix}${message}`);
    if (isTty) {
      render();
    }
  }

  function pushRecent(line: string): void {
    recent.unshift(line);
    if (recent.length > maxRecent) {
      recent.pop();
    }
  }

  function ensureTimer(): void {
    if (!isTty || interval) {
      return;
    }
    process.stdout.write("\x1b[?25l");
    interval = setInterval(() => {
      render();
    }, 80);
  }

  return {
    startTask(id: string, message: string): void {
      active.set(id, message);
      taskStarts.set(id, Date.now());
      lastMessage = message;
      ensureTimer();
      if (!isTty) {
        console.log(`[${current}/${total}] ${message}`);
        return;
      }
      render();
    },
    updateTask(id: string, message: string): void {
      if (active.has(id)) {
        active.set(id, message);
      }
      lastMessage = message;
      render();
    },
    finishTask(id: string, message: string): void {
      active.delete(id);
      taskStarts.delete(id);
      current = Math.min(total, current + 1);
      lastMessage = message;
      pushRecent(message);
      if (!isTty) {
        console.log(`[${current}/${total}] ${message}`);
        return;
      }
      render();
    },
    failTask(id: string, message: string): void {
      active.delete(id);
      taskStarts.delete(id);
      current = Math.min(total, current + 1);
      lastMessage = message;
      pushRecent(message);
      if (!isTty) {
        console.log(`[${current}/${total}] ${message}`);
        return;
      }
      render();
    },
    logOk(message: string): void {
      logLine(`${COLOR.green}[OK]${COLOR.reset}      `, message);
    },
    logInfo(message: string): void {
      logLine(`${COLOR.blue}[INFO]${COLOR.reset}    `, message);
    },
    logWarn(message: string): void {
      logLine(`${COLOR.yellow}[WARN]${COLOR.reset}    `, message);
    },
    logError(message: string): void {
      logLine(`${COLOR.red}[ERROR]${COLOR.reset}   `, message);
    },
    stop(): void {
      if (isTty) {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        process.stdout.write("\x1b[?25h");
        logUpdate.clear();
      }
    },
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatEta(current: number, total: number, startedAt: number): string {
  if (current === 0 || total === 0 || current >= total) {
    return "";
  }
  const elapsed = Date.now() - startedAt;
  const perItem = elapsed / current;
  const remaining = Math.max(0, Math.round(perItem * (total - current)));
  return formatDuration(remaining);
}
