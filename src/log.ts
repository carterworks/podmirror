export function logOk(message: string): void {
  console.log(`[OK]      ${message}`);
}

export function logInfo(message: string): void {
  console.log(`[INFO]    ${message}`);
}

export function logWarn(message: string): void {
  console.log(`[WARN]    ${message}`);
}

export function logError(message: string): void {
  console.log(`[ERROR]   ${message}`);
}

export function logProgress(current: number, total: number, message: string): void {
  const prefix = `[${current}/${total}]`;
  console.log(`${prefix} ${message}`);
}
