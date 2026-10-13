import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './cloud.mjs';
export async function configuration(filename, values) {
  const parsed = JSON.parse(await readFile(path.join(root, filename), 'utf8'));
  function expand(value) {
    if (typeof value === 'string') return value.replace(/\$\{([A-Z_]+)\}/g, (match, name) => {
      if (values[name] === undefined) throw new Error(`Missing configuration value: ${name}`);
      return values[name];
    });
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
    return value;
  }
  return expand(parsed);
}