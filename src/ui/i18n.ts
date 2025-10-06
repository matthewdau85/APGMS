import copy from '../../content/copy.json';

type CopyMap = Record<string, string>;

const strings: CopyMap = copy as CopyMap;

export function t(key: string): string {
  return strings[key] ?? key;
}
