export function remember(lines: string[], line: string, limit: number): string[] {
  const next = lines.length >= limit ? lines.slice(lines.length - limit + 1) : lines.slice();
  next.push(line);
  return next;
}

export function formatLogLine(now: Date, message: string): string {
  return `${now.toISOString()} ${message.replace(/[\r\n]+/g, " ")}`;
}
