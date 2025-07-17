
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

export function deepMergeTrie(
  target: Record<string, any>,
  source: Record<string, any>
): Record<string, any> {
  for (const key in source) {
    if (
      key in target &&
      typeof target[key] === 'object' &&
      typeof source[key] === 'object'
    ) {
      deepMergeTrie(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export function deepMergeTries(...objects: Record<string, any>[]): Record<string, any> {
  return objects.reduce((acc, obj) => deepMergeTrie(acc, obj), {});
}

export function trieHasPath(
  trie: Record<string, any>,
  keys: Iterable<string>
): boolean {
  let current: any = trie;
  for (const key of keys) {
    if (
      typeof current !== 'object' ||
      current === null ||
      !(key in current)
    ) {
      return false;
    }
    current = current[key];
  }
  return true;
}
