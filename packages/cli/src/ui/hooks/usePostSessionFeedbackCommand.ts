/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import type { SessionRating } from '../components/PostSessionFeedbackDialog.js';
import { EndSessionEvent, logEndSession, type Config } from '@google/gemini-cli-core';
import { appEvents, AppEvent } from '../../utils/events.js';

function waitForPostSessionFeedbackDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    appEvents.on(AppEvent.ClosePostSessionFeedbackDialog, () => {
      console.log('Resolving PostSessionFeedbackDialog.');
      resolve(true);
    });
  });
}

export const usePostSessionFeedbackCommand = (config: Config) => {
  const [isPostSessionFeedbackDialogOpen, setIsPostSessionFeedbackDialogOpen] = useState(
    false
  );

  const openPostSessionFeedbackDialog = useCallback(() => {
    console.log('Opening feedback dialog...');
    setIsPostSessionFeedbackDialogOpen(true);
    return waitForPostSessionFeedbackDialog();
  }, []);

  const handleSessionRatingSelect = useCallback(
    (rating?: SessionRating) => {
      if (rating) {
        console.log('Session feedback rating: %d', rating);
        logEndSession(config, new EndSessionEvent(config, rating));
      }
      
      appEvents.emit(AppEvent.ClosePostSessionFeedbackDialog);
      setIsPostSessionFeedbackDialogOpen(false);
    },
    [config],
  );

  return {
    isPostSessionFeedbackDialogOpen,
    openPostSessionFeedbackDialog,
    handleSessionRatingSelect,
  };
};
