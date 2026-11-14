'use client';
import { useCallback, useEffect, useState } from 'react';

const DRAFT_PREFIX = 'artsteel:draft:';

export function useFormDraft<T>(storageKey: string, enabled = true) {
  const fullKey = `${DRAFT_PREFIX}${storageKey}`;

  const loadDraft = useCallback((): T | null => {
    if (!enabled || typeof window === 'undefined' || !storageKey) return null;
    try {
      const raw = window.localStorage.getItem(fullKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }, [enabled, fullKey, storageKey]);

  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    setHasDraft(loadDraft() !== null);
  }, [loadDraft]);

  const saveDraft = useCallback(
    (value: T) => {
      if (!enabled || typeof window === 'undefined' || !storageKey) return;
      try {
        window.localStorage.setItem(fullKey, JSON.stringify(value));
        setHasDraft(true);
      } catch {
        // Ignore storage quota or private browsing errors.
      }
    },
    [enabled, fullKey, storageKey],
  );

  const clearDraft = useCallback(() => {
    if (typeof window === 'undefined' || !storageKey) return;
    try {
      window.localStorage.removeItem(fullKey);
      setHasDraft(false);
    } catch {
      // Ignore storage cleanup errors.
    }
  }, [fullKey, storageKey]);

  return { loadDraft, saveDraft, clearDraft, hasDraft };
}
