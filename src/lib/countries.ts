export const COUNTRY_OPTIONS = [
  ['RU', 'Россия'],
  ['UA', 'Украина'],
  ['BY', 'Беларусь'],
  ['KZ', 'Казахстан'],
  ['AM', 'Армения'],
  ['GE', 'Грузия'],
  ['AZ', 'Азербайджан'],
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['DE', 'Deutschland'],
  ['FR', 'France'],
  ['ES', 'España'],
  ['IT', 'Italia'],
  ['PL', 'Polska'],
  ['NL', 'Nederland'],
  ['TR', 'Türkiye'],
  ['IN', 'India'],
  ['CN', '中国'],
  ['JP', '日本'],
  ['BR', 'Brasil'],
  ['AR', 'Argentina'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
] as const;

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function countryCodeToFlag(code: string | null | undefined): string {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return '◫';
  return String.fromCodePoint(...[...normalized].map((letter) => 127397 + letter.charCodeAt(0)));
}
