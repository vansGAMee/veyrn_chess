'use client';

import { COUNTRY_OPTIONS, countryCodeToFlag } from '@/lib/countries';
import { CountryFlag } from '@/components/CountryFlag';

interface CountrySelectProps {
  value: string;
  onChange: (country: string) => void;
  compact?: boolean;
}

export function CountrySelect({ value, onChange, compact = false }: CountrySelectProps) {
  const listed = COUNTRY_OPTIONS.some(([code]) => code === value);
  return (
    <label className={`country-select ${compact ? 'compact' : ''}`}>
      <span className="country-select-flag"><CountryFlag code={value} /></span>
      {compact && <strong aria-hidden="true">{value}</strong>}
      <span className="sr-only">Страна</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Страна игрока">
        {!listed && <option value={value}>{countryCodeToFlag(value)} {value}</option>}
        {COUNTRY_OPTIONS.map(([code, name]) => <option value={code} key={code}>{countryCodeToFlag(code)} {name}</option>)}
      </select>
    </label>
  );
}
