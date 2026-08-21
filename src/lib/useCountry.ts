'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeCountryCode } from '@/lib/countries';

const STORAGE_KEY = 'veyrn:country:v1';

function languageCountry(): string {
  if (typeof navigator === 'undefined') return 'RU';
  const locale = navigator.language.split('-')[1];
  return normalizeCountryCode(locale) || (navigator.language.startsWith('ru') ? 'RU' : 'GB');
}

export function useCountry() {
  const [country, setCountryState] = useState('RU');
  const [source, setSource] = useState<'saved' | 'ip' | 'language'>('language');
  const [ready, setReady] = useState(false);
  const manuallySelected = useRef(false);

  useEffect(() => {
    let active = true;
    const saved = normalizeCountryCode(localStorage.getItem(STORAGE_KEY));
    const initial = saved || languageCountry();
    const frame = requestAnimationFrame(() => {
      if (!active) return;
      setCountryState(initial);
      setSource(saved ? 'saved' : 'language');
      setReady(true);
    });

    if (saved) {
      return () => {
        active = false;
        cancelAnimationFrame(frame);
      };
    }

    fetch('/api/country', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { country?: string }) => {
        const detected = normalizeCountryCode(data.country);
        if (active && detected && !manuallySelected.current) {
          localStorage.setItem(STORAGE_KEY, detected);
          setCountryState(detected);
          setSource('ip');
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  const setCountry = useCallback((value: string) => {
    const normalized = normalizeCountryCode(value);
    if (!normalized) return;
    manuallySelected.current = true;
    localStorage.setItem(STORAGE_KEY, normalized);
    setCountryState(normalized);
    setSource('saved');
  }, []);

  return { country, setCountry, source, ready };
}
