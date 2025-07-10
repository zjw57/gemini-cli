/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import AsciiLogo from './AsciiLogo';

const container = document.getElementById('logo-container');
if (container) {
  const root = createRoot(container);
  root.render(<AsciiLogo />);
}
