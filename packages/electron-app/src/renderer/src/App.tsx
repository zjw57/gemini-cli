/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from 'xterm-addon-fit'
import '@xterm/xterm/css/xterm.css';
import { Sun, Moon } from 'lucide-react'

const darkTheme = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  selectionBackground: '#44475a',
  black: '#000000',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#bfbfbf',
  brightBlack: '#4d4d4d',
  brightRed: '#ff6e67',
  brightGreen: '#5af78e',
  brightYellow: '#f4f99d',
  brightBlue: '#caa9fa',
  brightMagenta: '#ff92d0',
  brightCyan: '#9aedfe',
  brightWhite: '#e6e6e6',
};

const lightTheme = {
  background: '#ffffff',
  foreground: '#282a36',
  cursor: '#282a36',
  selectionBackground: '#e0e0e0',
  black: '#000000',
  red: '#d70000',
  green: '#008700',
  yellow: '#f5a503',
  blue: '#005faf',
  magenta: '#d70087',
  cyan: '#008787',
  white: '#bfbfbf',
  brightBlack: '#4d4d4d',
  brightRed: '#ff0000',
  brightGreen: '#00af00',
  brightYellow: '#f8d000',
  brightBlue: '#0087ff',
  brightMagenta: '#ff00af',
  brightCyan: '#00afaf',
  brightWhite: '#e6e6e6',
};

function debounce<T extends (...args: unknown[]) => void>(func: T, timeout = 100): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(this, args);
    }, timeout);
  };
}


function App() {
  const termRef = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal>()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') as 'light' | 'dark') || 'dark');
  const [cliTheme, setCliTheme] = useState(darkTheme);

  useEffect(() => {
    window.electron.theme.onInit((_event: unknown, theme: Record<string, string>) => {
      setCliTheme(theme);
    });
  }, []);

  useEffect(() => {
    if (termRef.current && !term.current) {
      const fitAddon = new FitAddon();
      term.current = new Terminal({
        fontFamily: 'Menlo, "DejaVu Sans Mono", Consolas, "Lucida Console", monospace',
        fontSize: 14,
        cursorBlink: true,
        allowTransparency: true,
      });
      term.current.loadAddon(fitAddon);
      term.current.open(termRef.current);

      const onResize = () => {
        try {
            const geometry = fitAddon.proposeDimensions();
            if (geometry && geometry.cols > 0 && geometry.rows > 0) {
                window.electron.terminal.resize({ cols: geometry.cols, rows: geometry.rows });
            }
            fitAddon.fit();
        } catch {
            // Ignore resize errors
        }
      };

      const debouncedResize = debounce(onResize, 50);

      // Initial resize with a small delay to allow layout to settle
      setTimeout(() => onResize(), 100);

      window.electron.terminal.onData((_event, data) => {
        term.current?.write(data);
      });

      term.current.onData((data) => {
        window.electron.terminal.sendKey(data);
      });

      const resizeObserver = new ResizeObserver(debouncedResize);
      resizeObserver.observe(termRef.current);
      window.addEventListener('focus', onResize);

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('focus', onResize);
      };
    }
  }, [])

  useEffect(() => {
    if (theme === 'dark') {
      document.body.classList.add('dark');
      document.body.classList.remove('light');
    } else {
      document.body.classList.add('light');
      document.body.classList.remove('dark');
    }
    if (term.current) {
      term.current.options.theme = theme === 'dark' ? cliTheme : lightTheme;
    }
    window.electron.theme.set(theme);
    localStorage.setItem('theme', theme);
  }, [theme, cliTheme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'dark' ? 'light' : 'dark');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          height: '30px',
          backgroundColor: theme === 'dark' ? '#21222c' : '#f1f1f1',
          color: theme === 'dark' ? '#f8f8f2' : '#282a36',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          fontSize: '12px',
          // @ts-expect-error -webkit-app-region is a valid property in Electron
          '-webkit-app-region': 'drag',
          flexShrink: 0,
          position: 'relative',
          userSelect: 'none',
          borderBottom: `1px solid ${theme === 'dark' ? '#44475a' : '#e0e0e0'}`
        }}
      >
        <span style={{ flex: 1, textAlign: 'center' }}>Gemini CLI</span>
        <button onClick={toggleTheme} style={{ position: 'absolute', right: '10px', top: '5px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', WebkitAppRegion: 'no-drag' }}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
      <div ref={termRef} style={{ width: '100%', flex: 1, padding: '0 10px 10px 10px', boxSizing: 'border-box' }} />
    </div>
  )
}

export default App
