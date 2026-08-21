import {
  AM, AR, AU, AZ, BR, BY, CA, CN, DE, ES, FR, GB, GE, IN, IT, JP, KZ, NL, PL, RU, TR, UA, US,
} from 'country-flag-icons/react/3x2';
import { normalizeCountryCode } from '@/lib/countries';

const FLAGS: Record<string, typeof RU> = {
  AM, AR, AU, AZ, BR, BY, CA, CN, DE, ES, FR, GB, GE, IN, IT, JP, KZ, NL, PL, RU, TR, UA, US,
};

export function CountryFlag({ code, className = '' }: { code: string | null | undefined; className?: string }) {
  const normalized = normalizeCountryCode(code);
  const Flag = normalized ? FLAGS[normalized] : null;
  if (!Flag) return <span className={`country-flag-placeholder ${className}`} aria-hidden="true">—</span>;
  return <Flag className={`country-flag-svg ${className}`} role="img" aria-label={`Flag of ${normalized}`} />;
}
