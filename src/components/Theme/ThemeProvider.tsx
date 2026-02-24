'use client';
import { useEffect } from 'react';

import styles from './theme.module.css';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add(styles.dark);
  }, []);
  return children;
}
