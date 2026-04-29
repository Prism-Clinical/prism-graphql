'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLazyQuery } from '@apollo/client/react';
import { SEARCH_CODES } from '@/lib/graphql/queries/pathways';

interface CodeResult {
  code: string;
  system: string;
  description: string;
  category: string | null;
  isCommon: boolean;
}

interface CodeSearchComboboxProps {
  system?: string;
  value?: { code: string; system: string; display?: string };
  onChange: (code: { code: string; system: string; display: string }) => void;
  placeholder?: string;
}

export function CodeSearchCombobox({ system, value, onChange, placeholder = 'Search codes...' }: CodeSearchComboboxProps) {
  const [inputValue, setInputValue] = useState(value?.code ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchCodes, { data, loading }] = useLazyQuery<{ searchCodes: CodeResult[] }>(SEARCH_CODES, {
    fetchPolicy: 'cache-first',
  });

  const results = data?.searchCodes ?? [];

  // Sync external value changes
  useEffect(() => {
    setInputValue(value?.code ?? '');
  }, [value?.code]);

  const doSearch = useCallback((query: string) => {
    if (query.length < 1) return;
    searchCodes({ variables: { query, system: system ?? null, limit: 20 } });
  }, [searchCodes, system]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setIsOpen(true);
    setHighlightIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.length >= 1) {
      debounceRef.current = setTimeout(() => {
        doSearch(val);
      }, 300);
    }
  }, [doSearch]);

  const handleSelect = useCallback((result: CodeResult) => {
    setInputValue(result.code);
    setIsOpen(false);
    onChange({ code: result.code, system: result.system, display: result.description });
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(results[highlightIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, [isOpen, results, highlightIndex, handleSelect]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const systemColors: Record<string, string> = {
    'ICD-10': 'bg-blue-100 text-blue-700',
    'SNOMED': 'bg-purple-100 text-purple-700',
    'LOINC': 'bg-emerald-100 text-emerald-700',
    'RXNORM': 'bg-orange-100 text-orange-700',
    'CPT': 'bg-rose-100 text-rose-700',
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => { if (inputValue.length >= 1 && results.length > 0) setIsOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      {isOpen && (inputValue.length >= 1) && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-xs text-gray-400">Searching...</div>
          )}

          {!loading && results.length === 0 && inputValue.length >= 1 && (
            <div className="px-3 py-2 text-xs text-gray-400">No results found</div>
          )}

          {results.map((result, idx) => (
            <button
              key={`${result.system}-${result.code}`}
              type="button"
              onClick={() => handleSelect(result)}
              className={`w-full text-left px-3 py-2 flex items-start gap-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 ${
                idx === highlightIndex ? 'bg-blue-50' : ''
              }`}
            >
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0 mt-0.5 ${systemColors[result.system] ?? 'bg-gray-100 text-gray-700'}`}>
                {result.system}
              </span>
              <span className="flex-1 min-w-0">
                <span className="font-mono text-xs font-semibold text-gray-900">{result.code}</span>
                <span className="block text-xs text-gray-500 truncate">{result.description}</span>
              </span>
              {result.isCommon && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-1.5" title="Common code" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
