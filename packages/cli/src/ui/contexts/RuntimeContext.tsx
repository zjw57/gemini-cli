/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, ReactNode } from 'react';
import { IRuntime } from '@google/gemini-cli-core/runtime';

export const RuntimeContext = createContext<IRuntime | null>(null);

/**
 * Custom hook to access the core runtime instance.
 * Throws an error if used outside of a RuntimeProvider.
 */
export const useRuntime = (): IRuntime => {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error('useRuntime must be used within a RuntimeProvider');
  }
  return context;
};

interface RuntimeProviderProps {
  children: ReactNode;
  runtime: IRuntime;
}

/**
 * Provides the core runtime instance to the React component tree.
 * This should be placed at the root of the application.
 */
export const RuntimeProvider = ({ children, runtime }: RuntimeProviderProps) => {
  return (
    <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
  );
};