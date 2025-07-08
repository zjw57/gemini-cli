import React from 'react';
import { longAsciiLogo } from '../../cli/src/ui/components/AsciiArt';

const AsciiLogo = () => {
  return (
    <pre className="ascii-logo">
      {longAsciiLogo}
    </pre>
  );
};

export default AsciiLogo;
