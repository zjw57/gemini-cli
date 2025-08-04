/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { NotificationSchema } from '@modelcontextprotocol/sdk/types.js';

export const DiffUpdateNotificationSchema = NotificationSchema.extend({
  method: z.literal('diffUpdate'),
  params: z.object({
    filePath: z.string(),
    status: z.enum(['accepted', 'rejected']),
  }),
});
