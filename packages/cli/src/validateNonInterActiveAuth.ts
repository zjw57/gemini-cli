/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, Config } from '@google/gemini-cli-core';
import { USER_SETTINGS_PATH } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  nonInteractiveConfig: Config,
) {
  const effectiveAuthType =
    configuredAuthType ||
    (process.env.GOOGLE_GENAI_USE_GCP === 'true'
      ? AuthType.LOGIN_WITH_GOOGLE
      : process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
        ? AuthType.USE_VERTEX_AI
        : process.env.GEMINI_API_KEY
          ? AuthType.USE_GEMINI
          : undefined);

  if (!effectiveAuthType) {
    console.error(
      `Please set an Auth method in your ${USER_SETTINGS_PATH} or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCP`,
    );
    process.exit(1);
  }

  const err = validateAuthMethod(effectiveAuthType);
  if (err != null) {
    console.error(err);
    process.exit(1);
  }

  await nonInteractiveConfig.refreshAuth(effectiveAuthType);
  return nonInteractiveConfig;
}
