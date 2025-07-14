
export function assert(truth: any, message?: string): void {
  if (!truth) {
    throw new Error("Assertion failed" + (message ? ": " + message : ""));
  }
}

export function isUrl(str: string): boolean {
  return /^https?:\/\/(?:[-\w.]|(?:%[\da-fA-F]{2}))+(?:\S*)$/i.test(str);
}

export function getKeyWithValue(map: Record<string, any>, needle: any): string | undefined {
  return Object.entries(map).find(([, v]) => v === needle)?.[0];
}
