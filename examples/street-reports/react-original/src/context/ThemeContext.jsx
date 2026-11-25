import { createContext, use, useCallback, useEffect, useMemo } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage.js';

const ThemeContext = createContext(null);

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [stored, setStored] = useLocalStorage('street-reports:theme', null);
  const theme = stored === 'dark' || stored === 'light' ? stored : systemTheme();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => setStored(theme === 'dark' ? 'light' : 'dark'), [theme, setStored]);
  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  return use(ThemeContext);
}
