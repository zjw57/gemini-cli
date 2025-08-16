/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExtensionScope } from '../config/settings-manager.js';

export function getScope(argv: {
  scope?: string;
  project?: boolean;
  user?: boolean;
}): ExtensionScope {
  if (argv.scope) {
    return argv.scope as ExtensionScope;
  }
  if (argv.project) {
    return 'project';
  }
  return 'user';
}
