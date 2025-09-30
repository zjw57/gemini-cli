/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiCLIExtension } from '@google/gemini-cli-core';
import { getErrorMessage } from '../../utils/errors.js';
import { ExtensionUpdateState } from '../state/extensions.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { MessageType, type ConfirmationRequest } from '../types.js';
import {
  checkForAllExtensionUpdates,
  updateExtension,
} from '../../config/extensions/update.js';
import { requestConsentInteractive } from '../../config/extension.js';

export const useExtensionUpdates = (
  extensions: GeminiCLIExtension[],
  addItem: UseHistoryManagerReturn['addItem'],
  cwd: string,
) => {
  const [extensionsUpdateState, setExtensionsUpdateState] = useState(
    new Map<string, ExtensionUpdateState>(),
  );
  const [confirmUpdateExtensionRequests, setConfirmUpdateExtensionRequests] =
    useState<
      Array<{
        prompt: React.ReactNode;
        onConfirm: (confirmed: boolean) => void;
      }>
    >([]);
  const addConfirmUpdateExtensionRequest = useCallback(
    (original: ConfirmationRequest) => {
      const wrappedRequest = {
        prompt: original.prompt,
        onConfirm: (confirmed: boolean) => {
          // Remove it from the outstanding list of requests by identity.
          setConfirmUpdateExtensionRequests((prev) =>
            prev.filter((r) => r !== wrappedRequest),
          );
          original.onConfirm(confirmed);
        },
      };
      setConfirmUpdateExtensionRequests((prev) => [...prev, wrappedRequest]);
    },
    [setConfirmUpdateExtensionRequests],
  );

  const latestState = useRef({
    extensions,
    addItem,
    cwd,
    extensionsUpdateState,
    addConfirmUpdateExtensionRequest,
  });
  latestState.current = {
    extensions,
    addItem,
    cwd,
    extensionsUpdateState,
    addConfirmUpdateExtensionRequest,
  };

  // Intentionally only check for updates once, on mount.
  // If we care about checking when cwd or extensions change, we will need to
  // modify this logic and add checks to ensure we don't end up with multiple
  // concurrent checks.
  useEffect(() => {
    const checkForUpdates = async () => {
      const {
        extensions,
        addItem,
        cwd,
        extensionsUpdateState,
        addConfirmUpdateExtensionRequest,
      } = latestState.current;
      const updateState = await checkForAllExtensionUpdates(
        extensions,
        extensionsUpdateState,
        setExtensionsUpdateState,
      );
      let extensionsWithUpdatesCount = 0;
      for (const extension of extensions) {
        const prevState = extensionsUpdateState.get(extension.name);
        const currentState = updateState.get(extension.name);
        if (
          prevState === currentState ||
          currentState !== ExtensionUpdateState.UPDATE_AVAILABLE
        ) {
          continue;
        }
        if (extension.installMetadata?.autoUpdate) {
          updateExtension(
            extension,
            cwd,
            (description) =>
              requestConsentInteractive(
                description,
                addConfirmUpdateExtensionRequest,
              ),
            currentState,
            (newState) => {
              setExtensionsUpdateState((prev) => {
                const finalState = new Map(prev);
                finalState.set(extension.name, newState);
                return finalState;
              });
            },
          )
            .then((result) => {
              if (!result) return;
              addItem(
                {
                  type: MessageType.INFO,
                  text: `Extension "${extension.name}" successfully updated: ${result.originalVersion} → ${result.updatedVersion}.`,
                },
                Date.now(),
              );
            })
            .catch((error) => {
              addItem(
                {
                  type: MessageType.ERROR,
                  text: getErrorMessage(error),
                },
                Date.now(),
              );
            });
        } else {
          extensionsWithUpdatesCount++;
        }
      }
      if (extensionsWithUpdatesCount > 0) {
        const s = extensionsWithUpdatesCount > 1 ? 's' : '';
        addItem(
          {
            type: MessageType.INFO,
            text: `You have ${extensionsWithUpdatesCount} extension${s} with an update available, run "/extensions list" for more information.`,
          },
          Date.now(),
        );
      }
    };

    void checkForUpdates();
  }, []);

  return {
    extensionsUpdateState,
    setExtensionsUpdateState,
    confirmUpdateExtensionRequests,
    addConfirmUpdateExtensionRequest,
  };
};
