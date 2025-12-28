
export function assert(truth: unknown, message?: string): void {
  if (!truth) {
    throw new Error("Assertion failed" + (message ? ": " + message : ""));
  }
}

export type StringTree = {
  [key: string]: StringTree;
};

export function isUrl(str: string): boolean {
  return /^https?:\/\/(?:[-\w.]|(?:%[\da-fA-F]{2}))+(?:\S*)$/i.test(str);
}

export function getKeyWithValue(map: Record<string, unknown>, needle: unknown): string | undefined {
  return Object.entries(map).find(([, v]) => v === needle)?.[0];
}

export function deepMergeTrie(
  target: StringTree,
  source: StringTree
): StringTree {
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

export function deepMergeTries(...objects: StringTree[]): StringTree {
  return objects.reduce((acc, obj) => deepMergeTrie(acc, obj), {});
}

export function trieHasPath(
  trie: StringTree,
  keys: Iterable<string>
): boolean {
  let current: StringTree = trie;
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
