import { tr, type Strings } from './tr';

const languages: Record<string, Strings> = { tr };

let current: Strings = tr;

export function setLanguage(code: string): void {
  current = languages[code] ?? tr;
  document.documentElement.lang = code in languages ? code : 'tr';
}

/** Typed access to the active language's strings. */
export function strings(): Strings {
  return current;
}
