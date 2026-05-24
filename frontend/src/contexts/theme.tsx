import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Theme = 'void' | 'terminal' | 'paper' | 'midnight' | 'graphite' | 'ember' | 'japan';

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'void', setTheme: () => {} });

const THEME_LABELS: Record<Theme, string> = {
  void: 'Void',
  terminal: 'Terminal',
  paper: 'Paper',
  midnight: 'Midnight',
  graphite: 'Graphite',
  ember: 'Ember',
  japan: 'Japan',
};

export const THEME_LIST: Theme[] = ['void', 'midnight', 'graphite', 'ember', 'japan', 'terminal', 'paper'];
export { THEME_LABELS };

const THEMES: Theme[] = ['void', 'terminal', 'paper', 'midnight', 'graphite', 'ember', 'japan'];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('sw_theme') as Theme;
    return THEMES.includes(stored) ? stored : 'void';
  });

  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('theme-void', 'theme-terminal', 'theme-paper', 'theme-midnight', 'theme-graphite', 'theme-ember', 'theme-japan');
    el.classList.add(`theme-${theme}`);
  }, [theme]);

  function setTheme(t: Theme) {
    localStorage.setItem('sw_theme', t);
    setThemeState(t);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
