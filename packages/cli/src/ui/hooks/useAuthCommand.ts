/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { getErrorMessage } from '@google/gemini-cli-core';
import { AuthType } from '@google/gemini-cli-core/runtime';
import { useRuntime } from '../contexts/RuntimeContext.js';
import {
  listenForOauthCode,
  getAvailablePort,
} from '../utils/localAuthServer.js';
import open from 'open';
import http from 'http';

/**
 * A modern hook to manage the authentication flow for the Gemini CLI.
 * It orchestrates the headless `core` runtime to perform authentication,
 * while being solely responsible for UI-related tasks like opening dialogs
 * and browsers.
 *
 * @param settings The loaded settings instance for the CLI.
 * @param setAuthError A state setter to communicate errors back to the UI.
 * @returns An object with state and callbacks to drive the auth UI.
 */
export const useAuthCommand = (
  settings: LoadedSettings,
  setAuthError: (error: string | null) => void,
) => {
  const runtime = useRuntime();
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(
    !settings.merged.selectedAuthType,
  );
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authServer, setAuthServer] = useState<http.Server | null>(null);

  const openAuthDialog = useCallback(() => setIsAuthDialogOpen(true), []);

  /**
   * Cancels an in-progress authentication attempt. This is critical for UX
   * if the user decides to abort.
   */
  const cancelAuthentication = useCallback(() => {
    // Close the listening HTTP server to free the port and stop the flow.
    authServer?.close();
    setAuthServer(null);
    setIsAuthenticating(false);
  }, [authServer]);

  /**
   * The primary handler for when a user selects an authentication method.
   */
  const handleAuthSelect = useCallback(
    async (authType: AuthType | undefined, scope: SettingScope) => {
      setIsAuthDialogOpen(false);
      setAuthError(null);

      if (!authType) return;

      // Always update the setting first. For non-interactive flows, this is all we do.
      settings.setValue(scope, 'selectedAuthType', authType);

      // The "Login with Google" flow is interactive and requires orchestration.
      if (authType === AuthType.LOGIN_WITH_GOOGLE) {
        setIsAuthenticating(true);
        try {
          await runtime.clearCachedCredentials();

          const port = await getAvailablePort();
          const redirectUri = `http://localhost:${port}/oauth2callback`;

          const loginRequest = await runtime.getWebLoginRequest(redirectUri);

          const serverInfo = await listenForOauthCode(loginRequest.state, port);
          setAuthServer(serverInfo.server); // Store server for potential cancellation.

          await open(loginRequest.url);
          console.log(`\n\nAwaiting authentication in your browser...`);

          const authCode = await serverInfo.codePromise;

          await runtime.exchangeCodeForToken(authCode, redirectUri);
          setAuthError(null); // Explicitly clear any previous errors on success.
        } catch (e) {
          // If any part of the flow fails, show the error and re-open the dialog.
          setAuthError(getErrorMessage(e));
          openAuthDialog();
        } finally {
          // H. Clean up UI state regardless of success or failure.
          setIsAuthenticating(false);
          setAuthServer(null);
        }
      } else {
        // For non-interactive auth types (e.g., API Key), there's nothing more
        // to do here. The setting has been saved. The runtime will use it and
        // validate environment variables on the *next* application execution.
      }
    },
    [runtime, settings, setAuthError, openAuthDialog],
  );

  return {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating,
    cancelAuthentication,
  };
};