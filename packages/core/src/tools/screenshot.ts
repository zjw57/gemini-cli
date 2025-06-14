/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseTool,
  ToolCallConfirmationDetails,
  ToolResult,
  ToolConfirmationOutcome,
} from './tools.js';
import screenshot from 'screenshot-desktop';
import { Blob, Part } from '@google/genai';
import { Config, ApprovalMode } from '../config/config.js';

const screenshotToolDescription = `Takes a screenshot of user screen.
It allows model to be able to see the user's screen. Without this tool,
model cannot access to user's screen visually.
This tool is useful in cases such as:
- What the model can visually see on their screen.
- Asking about desktop applications visible on the user screen.
- Helping users with UIs, e.g. providing usability tips and assistence.
- Turning visual artifacts into text, e.g. describing an image.`;

/**
 * Represents a tool that can "take a screenshot" of the current CLI output.
 * Since a true graphical screenshot is not possible in this environment,
 * this tool will return a textual representation or description of the CLI state.
 */
export class ScreenshotTool extends BaseTool<unknown, ToolResult> {
  constructor(private readonly config: Config) {
    super('screenshot', 'Screenshot', screenshotToolDescription, {
      properties: {
        screenshots: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Required. An array of screenshots of user displays. User may have one or more displays.',
        },
      },
      required: ['screenshots'],
      type: 'object',
    });
  }

  override async shouldConfirmExecute(): Promise<
    ToolCallConfirmationDetails | false
  > {
    // TODO(jbd): Don't allow execution before confirmation.
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Confirm Screenshot`,
      prompt: '',
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  override async execute(): Promise<ToolResult> {
    const screenshotContent = 'Screenshot captured.';
    const screenshots: Part[] = await capture();
    return {
      llmContent: screenshots,
      returnDisplay: screenshotContent,
    };
  }
}

async function capture(): Promise<Part[]> {
  try {
    const displays = await screenshot.listDisplays();

    if (displays.length === 0) {
      throw new Error('No displays found.');
    }
    const parts = [];
    for (const display of displays) {
      const { id } = display;
      const imgBuffer = await screenshot({ screen: id, format: 'png' });
      const blob: Blob = {
        mimeType: 'image/png',
        data: imgBuffer.toString('base64'),
      };
      const part: Part = { inlineData: blob };
      parts.push(part);
    }
    return parts;
  } catch (error) {
    throw new Error('An error occurred while taking screenshots:' + error);
  }
}
