/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { longAsciiLogo } from '../../../cli/src/ui/components/AsciiArt';

const AsciiLogo = () => {
  return (
    <pre className="ascii-logo">
      {longAsciiLogo}
    </pre>
  );
};

export default AsciiLogo;
