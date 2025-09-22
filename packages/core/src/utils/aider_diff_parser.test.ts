/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseAiderDiff } from './aider_diff_parser.js';

describe('parseAiderDiff', () => {
  it('should parse a single diff', () => {
    const diff = `
path/to/file.py
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
`;
    const result = parseAiderDiff(diff);
    expect(result).toEqual([
      {
        filePath: 'path/to/file.py',
        search: 'from flask import Flask',
        replace: `import math
from flask import Flask`,
      },
    ]);
  });

  it('should parse multiple diffs', () => {
    const diff = `
path/to/file.py
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
path/to/another/file.py
<<<<<<< SEARCH
def hello():
    print("hello")
=======
def hello():
    print("hello world")
>>>>>>> REPLACE
`;
    const result = parseAiderDiff(diff);
    expect(result).toEqual([
      {
        filePath: 'path/to/file.py',
        search: 'from flask import Flask',
        replace: `import math
from flask import Flask`,
      },
      {
        filePath: 'path/to/another/file.py',
        search: `def hello():
    print("hello")`,
        replace: `def hello():
    print("hello world")`,
      },
    ]);
  });

  it('should handle empty search or replace blocks', () => {
    const diff = `
path/to/file.py
<<<<<<< SEARCH
=======
import math
from flask import Flask
>>>>>>> REPLACE
path/to/another/file.py
<<<<<<< SEARCH
def hello():
    print("hello")
=======
>>>>>>> REPLACE
`;
    const result = parseAiderDiff(diff);
    expect(result).toEqual([
      {
        filePath: 'path/to/file.py',
        search: '',
        replace: `import math
from flask import Flask`,
      },
      {
        filePath: 'path/to/another/file.py',
        search: `def hello():
    print("hello")`,
        replace: '',
      },
    ]);
  });

  it('should parse a diff-fenced format', () => {
    const diff = `
\`\`\`
path/to/file.py
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
\`\`\`
`;
    const result = parseAiderDiff(diff);
    expect(result).toEqual([
      {
        filePath: 'path/to/file.py',
        search: 'from flask import Flask',
        replace: `import math\nfrom flask import Flask`,
      },
    ]);
  });

  it('should handle variable whitespace and marker lengths', () => {
    const diff = `
  path/to/flexible.py
<<<<<<<<<<   SEARCH
  line 1
  line 2
============
  line 3
>>>>>>>>>>    REPLACE
`;
    const result = parseAiderDiff(diff);
    expect(result).toEqual([
      {
        filePath: 'path/to/flexible.py',
        search: `  line 1
  line 2`,
        replace: '  line 3',
      },
    ]);
  });

  it('should handle extra newlines between blocks', () => {
    const diff = `
path/to/newlines.py
<<<<<<< SEARCH

class MyClass:
  pass

=======

class YourClass:
  pass

>>>>>>> REPLACE
`;
    const result = parseAiderDiff(diff);
    expect(result).toEqual([
      {
        filePath: 'path/to/newlines.py',
        search: `
class MyClass:
  pass
`,
        replace: `
class YourClass:
  pass
`,
      },
    ]);
  });
});
