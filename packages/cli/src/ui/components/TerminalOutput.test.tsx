/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { TerminalOutput } from './TerminalOutput.js';

describe('<TerminalOutput />', () => {
  it('renders the output text correctly', () => {
    const { lastFrame } = render(<TerminalOutput output="Hello, World!" />);
    expect(lastFrame()).toContain('Hello, World!');
  });

  it('handles multi-line output correctly', () => {
    const output = 'Line 1\nLine 2\nLine 3';
    const { lastFrame } = render(<TerminalOutput output={output} />);
    expect(lastFrame()).toContain('Line 1');
    expect(lastFrame()).toContain('Line 2');
    expect(lastFrame()).toContain('Line 3');
  });

  it('handles empty output', () => {
    const { lastFrame } = render(<TerminalOutput output="" />);
    expect(lastFrame()).toBeTruthy();
  });

  it('renders ansi color codes', () => {
    const { lastFrame } = render(
      <TerminalOutput output="\u001b[31mHello\u001b[0m" />,
    );
    expect(lastFrame()).toContain('\u001b[31mHello\u001b[0m');
  });
});