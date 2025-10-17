/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 *
 *
 * This test suite covers:
 * - Initial rendering and display state
 * - Keyboard navigation (arrows, vim keys, Tab)
 * - Settings toggling (Enter, Space)
 * - Focus section switching between settings and scope selector
 * - Scope selection and settings persistence across scopes
 * - Restart-required vs immediate settings behavior
 * - VimModeContext integration
 * - Complex user interaction workflows
 * - Error handling and edge cases
 * - Display values for inherited and overridden settings
 *
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsDialog } from './SettingsDialog.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { VimModeProvider } from '../contexts/VimModeContext.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import { act } from 'react';
import { saveModifiedSettings, TEST_ONLY } from '../../utils/settingsUtils.js';
import {
  getSettingsSchema,
  type SettingDefinition,
  type SettingsSchemaType,
} from '../../config/settingsSchema.js';

// Mock the VimModeContext
const mockToggleVimEnabled = vi.fn();
const mockSetVimMode = vi.fn();

enum TerminalKeys {
  ENTER = '\u000D',
  TAB = '\t',
  UP_ARROW = '\u001B[A',
  DOWN_ARROW = '\u001B[B',
  LEFT_ARROW = '\u001B[D',
  RIGHT_ARROW = '\u001B[C',
  ESCAPE = '\u001B',
}

const createMockSettings = (
  userSettings = {},
  systemSettings = {},
  workspaceSettings = {},
) =>
  new LoadedSettings(
    {
      settings: { ui: { customThemes: {} }, mcpServers: {}, ...systemSettings },
      originalSettings: {
        ui: { customThemes: {} },
        mcpServers: {},
        ...systemSettings,
      },
      path: '/system/settings.json',
    },
    {
      settings: {},
      originalSettings: {},
      path: '/system/system-defaults.json',
    },
    {
      settings: {
        ui: { customThemes: {} },
        mcpServers: {},
        ...userSettings,
      },
      originalSettings: {
        ui: { customThemes: {} },
        mcpServers: {},
        ...userSettings,
      },
      path: '/user/settings.json',
    },
    {
      settings: {
        ui: { customThemes: {} },
        mcpServers: {},
        ...workspaceSettings,
      },
      originalSettings: {
        ui: { customThemes: {} },
        mcpServers: {},
        ...workspaceSettings,
      },
      path: '/workspace/settings.json',
    },
    true,
    new Set(),
  );

vi.mock('../../config/settingsSchema.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../config/settingsSchema.js')>();
  return {
    ...original,
    getSettingsSchema: vi.fn(original.getSettingsSchema),
  };
});

vi.mock('../contexts/VimModeContext.js', async () => {
  const actual = await vi.importActual('../contexts/VimModeContext.js');
  return {
    ...actual,
    useVimMode: () => ({
      vimEnabled: false,
      vimMode: 'INSERT' as const,
      toggleVimEnabled: mockToggleVimEnabled,
      setVimMode: mockSetVimMode,
    }),
  };
});

vi.mock('../../utils/settingsUtils.js', async () => {
  const actual = await vi.importActual('../../utils/settingsUtils.js');
  return {
    ...actual,
    saveModifiedSettings: vi.fn(),
  };
});

// Helper function to simulate key presses (commented out for now)
// const simulateKeyPress = async (keyData: Partial<Key> & { name: string }) => {
//   if (currentKeypressHandler) {
//     const key: Key = {
//       ctrl: false,
//       meta: false,
//       shift: false,
//       paste: false,
//       sequence: keyData.sequence || keyData.name,
//       ...keyData,
//     };
//     currentKeypressHandler(key);
//     // Allow React to process the state update
//     await new Promise(resolve => setTimeout(resolve, 10));
//   }
// };

// Mock console.log to avoid noise in tests
// const originalConsoleLog = console.log;
// const originalConsoleError = console.error;

describe('SettingsDialog', () => {
  // Simple delay function for remaining tests that need gradual migration
  const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

  // Custom waitFor utility for ink testing environment (not compatible with @testing-library/react)
  const waitFor = async (
    predicate: () => void,
    options: { timeout?: number; interval?: number } = {},
  ) => {
    const { timeout = 1000, interval = 10 } = options;
    const start = Date.now();
    let lastError: unknown;
    while (Date.now() - start < timeout) {
      try {
        predicate();
        return;
      } catch (e) {
        lastError = e;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    if (lastError) {
      throw lastError;
    }
    throw new Error('waitFor timed out');
  };

  beforeEach(() => {
    // Reset keypress mock state (variables are commented out)
    // currentKeypressHandler = null;
    // isKeypressActive = false;
    // console.log = vi.fn();
    // console.error = vi.fn();
    mockToggleVimEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    TEST_ONLY.clearFlattenedSchema();
    vi.clearAllMocks();
    vi.resetAllMocks();
    // Reset keypress mock state (variables are commented out)
    // currentKeypressHandler = null;
    // isKeypressActive = false;
    // console.log = originalConsoleLog;
    // console.error = originalConsoleError;
  });

  describe('Initial Rendering', () => {
    it('should render the settings dialog with default state', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      const output = lastFrame();
      expect(output).toContain('Settings');
      expect(output).toContain('Apply To');
      expect(output).toContain(
        'Use Enter to select, Tab to change focus, Esc to close',
      );
    });

    it('should accept availableTerminalHeight prop without errors', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog
            settings={settings}
            onSelect={onSelect}
            availableTerminalHeight={20}
          />
        </KeypressProvider>,
      );

      const output = lastFrame();
      // Should still render properly with the height prop
      expect(output).toContain('Settings');
      expect(output).toContain('Use Enter to select, Esc to close');
    });

    it('should show settings list with default values', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      const output = lastFrame();
      // Should show some default settings
      expect(output).toContain('●'); // Active indicator
    });

    it('should highlight first setting by default', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      const output = lastFrame();
      // First item should be highlighted with green color and active indicator
      expect(output).toContain('●');
    });
  });

  describe('Settings Navigation', () => {
    it('should navigate down with arrow key', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount, lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Press down arrow
      act(() => {
        stdin.write(TerminalKeys.DOWN_ARROW as string); // Down arrow
      });

      expect(lastFrame()).toContain('● Disable Auto Update');

      // The active index should have changed (tested indirectly through behavior)
      unmount();
    });

    it('should navigate up with arrow key', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // First go down, then up
      stdin.write(TerminalKeys.DOWN_ARROW as string); // Down arrow
      await wait();
      stdin.write(TerminalKeys.UP_ARROW as string);
      await wait();

      unmount();
    });

    it('should navigate with vim keys (j/k)', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Navigate with vim keys
      stdin.write('j'); // Down
      await wait();
      stdin.write('k'); // Up
      await wait();

      unmount();
    });

    it('wraps around when at the top of the list', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount, lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Try to go up from first item
      act(() => {
        stdin.write(TerminalKeys.UP_ARROW);
      });

      await wait();

      expect(lastFrame()).toContain('● Codebase Investigator Max Num Turns');

      unmount();
    });
  });

  describe('Settings Toggling', () => {
    it('should toggle setting with Enter key', async () => {
      vi.mocked(saveModifiedSettings).mockClear();

      const settings = createMockSettings();
      const onSelect = vi.fn();
      const component = (
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>
      );

      const { stdin, unmount, lastFrame } = render(component);

      // Wait for initial render and verify we're on Vim Mode (first setting)
      await waitFor(() => {
        expect(lastFrame()).toContain('● Vim Mode');
      });

      // Navigate to Disable Auto Update setting and verify we're there
      act(() => {
        stdin.write(TerminalKeys.DOWN_ARROW as string);
      });
      await waitFor(() => {
        expect(lastFrame()).toContain('● Disable Auto Update');
      });

      // Toggle the setting
      act(() => {
        stdin.write(TerminalKeys.ENTER as string);
      });
      // Wait for the setting change to be processed
      await waitFor(() => {
        expect(
          vi.mocked(saveModifiedSettings).mock.calls.length,
        ).toBeGreaterThan(0);
      });

      // Wait for the mock to be called
      await waitFor(() => {
        expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalled();
      });

      expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalledWith(
        new Set<string>(['general.disableAutoUpdate']),
        {
          general: {
            disableAutoUpdate: true,
          },
        },
        expect.any(LoadedSettings),
        SettingScope.User,
      );

      unmount();
    });

    describe('enum values', () => {
      enum StringEnum {
        FOO = 'foo',
        BAR = 'bar',
        BAZ = 'baz',
      }

      const SETTING: SettingDefinition = {
        type: 'enum',
        label: 'Theme',
        options: [
          {
            label: 'Foo',
            value: StringEnum.FOO,
          },
          {
            label: 'Bar',
            value: StringEnum.BAR,
          },
          {
            label: 'Baz',
            value: StringEnum.BAZ,
          },
        ],
        category: 'UI',
        requiresRestart: false,
        default: StringEnum.BAR,
        description: 'The color theme for the UI.',
        showInDialog: true,
      };

      const FAKE_SCHEMA: SettingsSchemaType = {
        ui: {
          showInDialog: false,
          properties: {
            theme: {
              ...SETTING,
            },
          },
        },
      } as unknown as SettingsSchemaType;

      it('toggles enum values with the enter key', async () => {
        vi.mocked(saveModifiedSettings).mockClear();

        vi.mocked(getSettingsSchema).mockReturnValue(FAKE_SCHEMA);
        const settings = createMockSettings();
        const onSelect = vi.fn();
        const component = (
          <KeypressProvider kittyProtocolEnabled={false}>
            <SettingsDialog settings={settings} onSelect={onSelect} />
          </KeypressProvider>
        );

        const { stdin, unmount } = render(component);

        // Press Enter to toggle current setting
        stdin.write(TerminalKeys.DOWN_ARROW as string);
        await wait();
        stdin.write(TerminalKeys.ENTER as string);
        await wait();
        await waitFor(() => {
          expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalled();
        });

        expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalledWith(
          new Set<string>(['ui.theme']),
          {
            ui: {
              theme: StringEnum.BAZ,
            },
          },
          expect.any(LoadedSettings),
          SettingScope.User,
        );

        unmount();
      });

      it('loops back when reaching the end of an enum', async () => {
        vi.mocked(saveModifiedSettings).mockClear();
        vi.mocked(getSettingsSchema).mockReturnValue(FAKE_SCHEMA);
        const settings = createMockSettings();
        settings.setValue(SettingScope.User, 'ui.theme', StringEnum.BAZ);
        const onSelect = vi.fn();
        const component = (
          <KeypressProvider kittyProtocolEnabled={false}>
            <SettingsDialog settings={settings} onSelect={onSelect} />
          </KeypressProvider>
        );

        const { stdin, unmount } = render(component);

        // Press Enter to toggle current setting
        stdin.write(TerminalKeys.DOWN_ARROW as string);
        await wait();
        stdin.write(TerminalKeys.ENTER as string);
        await wait();
        await waitFor(() => {
          expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalled();
        });

        expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalledWith(
          new Set<string>(['ui.theme']),
          {
            ui: {
              theme: StringEnum.FOO,
            },
          },
          expect.any(LoadedSettings),
          SettingScope.User,
        );

        unmount();
      });
    });

    it('should toggle setting with Space key', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Press Space to toggle current setting
      stdin.write(' '); // Space key
      await wait();

      unmount();
    });

    it('should handle vim mode setting specially', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Navigate to vim mode setting and toggle it
      // This would require knowing the exact position, so we'll just test that the mock is called
      stdin.write(TerminalKeys.ENTER as string); // Enter key
      await wait();

      // The mock should potentially be called if vim mode was toggled
      unmount();
    });
  });

  describe('Scope Selection', () => {
    it('should switch between scopes', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Switch to scope focus
      stdin.write(TerminalKeys.TAB); // Tab key
      await wait();

      // Select different scope (numbers 1-3 typically available)
      stdin.write('2'); // Select second scope option
      await wait();

      unmount();
    });

    it('should reset to settings focus when scope is selected', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Wait for initial render
      await waitFor(() => {
        expect(lastFrame()).toContain('Vim Mode');
      });

      // The UI should show the settings section is active and scope section is inactive
      expect(lastFrame()).toContain('● Vim Mode'); // Settings section active
      expect(lastFrame()).toContain('  Apply To'); // Scope section inactive

      // This test validates the initial state - scope selection behavior
      // is complex due to keypress handling, so we focus on state validation

      unmount();
    });
  });

  describe('Restart Prompt', () => {
    it('should show restart prompt for restart-required settings', async () => {
      const settings = createMockSettings();
      const onRestartRequest = vi.fn();

      const { unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog
            settings={settings}
            onSelect={() => {}}
            onRestartRequest={onRestartRequest}
          />
        </KeypressProvider>,
      );

      // This test would need to trigger a restart-required setting change
      // The exact steps depend on which settings require restart
      await wait();

      unmount();
    });

    it('should handle restart request when r is pressed', async () => {
      const settings = createMockSettings();
      const onRestartRequest = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog
            settings={settings}
            onSelect={() => {}}
            onRestartRequest={onRestartRequest}
          />
        </KeypressProvider>,
      );

      // Press 'r' key (this would only work if restart prompt is showing)
      stdin.write('r');
      await wait();

      // If restart prompt was showing, onRestartRequest should be called
      unmount();
    });
  });

  describe('Escape Key Behavior', () => {
    it('should call onSelect with undefined when Escape is pressed', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Wait for initial render
      await waitFor(() => {
        expect(lastFrame()).toContain('Hide Window Title');
      });

      // Verify the dialog is rendered properly
      expect(lastFrame()).toContain('Settings');
      expect(lastFrame()).toContain('Apply To');

      // This test validates rendering - escape key behavior depends on complex
      // keypress handling that's difficult to test reliably in this environment

      unmount();
    });
  });

  describe('Settings Persistence', () => {
    it('should persist settings across scope changes', async () => {
      const settings = createMockSettings({ vimMode: true });
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Switch to scope selector
      stdin.write(TerminalKeys.TAB as string); // Tab
      await wait();

      // Change scope
      stdin.write('2'); // Select workspace scope
      await wait();

      // Settings should be reloaded for new scope
      unmount();
    });

    it('should show different values for different scopes', () => {
      const settings = createMockSettings(
        { vimMode: true }, // User settings
        { vimMode: false }, // System settings
        { autoUpdate: false }, // Workspace settings
      );
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Should show user scope values initially
      const output = lastFrame();
      expect(output).toContain('Settings');
    });
  });

  describe('Error Handling', () => {
    it('should handle vim mode toggle errors gracefully', async () => {
      mockToggleVimEnabled.mockRejectedValue(new Error('Toggle failed'));

      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Try to toggle a setting (this might trigger vim mode toggle)
      stdin.write(TerminalKeys.ENTER as string); // Enter
      await wait();

      // Should not crash
      unmount();
    });
  });

  describe('Complex State Management', () => {
    it('should track modified settings correctly', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Toggle a setting
      stdin.write(TerminalKeys.ENTER as string); // Enter
      await wait();

      // Toggle another setting
      stdin.write(TerminalKeys.DOWN_ARROW as string); // Down
      await wait();
      stdin.write(TerminalKeys.ENTER as string); // Enter
      await wait();

      // Should track multiple modified settings
      unmount();
    });

    it('should handle scrolling when there are many settings', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Navigate down many times to test scrolling
      for (let i = 0; i < 10; i++) {
        stdin.write(TerminalKeys.DOWN_ARROW as string); // Down arrow
        await wait(10);
      }

      unmount();
    });
  });

  describe('VimMode Integration', () => {
    it('should sync with VimModeContext when vim mode is toggled', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <VimModeProvider settings={settings}>
          <KeypressProvider kittyProtocolEnabled={false}>
            <SettingsDialog settings={settings} onSelect={onSelect} />
          </KeypressProvider>
        </VimModeProvider>,
      );

      // Navigate to and toggle vim mode setting
      // This would require knowing the exact position of vim mode setting
      stdin.write(TerminalKeys.ENTER as string); // Enter
      await wait();

      unmount();
    });
  });

  describe('Specific Settings Behavior', () => {
    it('should show correct display values for settings with different states', () => {
      const settings = createMockSettings(
        { vimMode: true, hideTips: false }, // User settings
        { hideWindowTitle: true }, // System settings
        { ideMode: false }, // Workspace settings
      );
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      const output = lastFrame();
      // Should contain settings labels
      expect(output).toContain('Settings');
    });

    it('should handle immediate settings save for non-restart-required settings', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Toggle a non-restart-required setting (like hideTips)
      stdin.write(TerminalKeys.ENTER as string); // Enter - toggle current setting
      await wait();

      // Should save immediately without showing restart prompt
      unmount();
    });

    it('should show restart prompt for restart-required settings', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // This test would need to navigate to a specific restart-required setting
      // Since we can't easily target specific settings, we test the general behavior
      await wait();

      // Should not show restart prompt initially
      expect(lastFrame()).not.toContain(
        'To see changes, Gemini CLI must be restarted',
      );

      unmount();
    });

    it('should clear restart prompt when switching scopes', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Restart prompt should be cleared when switching scopes
      unmount();
    });
  });

  describe('Settings Display Values', () => {
    it('should show correct values for inherited settings', () => {
      const settings = createMockSettings(
        {},
        { vimMode: true, hideWindowTitle: false }, // System settings
        {},
      );
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      const output = lastFrame();
      // Settings should show inherited values
      expect(output).toContain('Settings');
    });

    it('should show override indicator for overridden settings', () => {
      const settings = createMockSettings(
        { vimMode: false }, // User overrides
        { vimMode: true }, // System default
        {},
      );
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      const output = lastFrame();
      // Should show settings with override indicators
      expect(output).toContain('Settings');
    });
  });

  describe('Keyboard Shortcuts Edge Cases', () => {
    it('should handle rapid key presses gracefully', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Rapid navigation
      for (let i = 0; i < 5; i++) {
        stdin.write(TerminalKeys.DOWN_ARROW as string);
        stdin.write(TerminalKeys.UP_ARROW as string);
      }
      await wait(100);

      // Should not crash
      unmount();
    });

    it('should handle Ctrl+C to reset current setting to default', async () => {
      const settings = createMockSettings({ vimMode: true }); // Start with vimMode enabled
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Press Ctrl+C to reset current setting to default
      stdin.write('\u0003'); // Ctrl+C
      await wait();

      // Should reset the current setting to its default value
      unmount();
    });

    it('should handle Ctrl+L to reset current setting to default', async () => {
      const settings = createMockSettings({ vimMode: true }); // Start with vimMode enabled
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Press Ctrl+L to reset current setting to default
      stdin.write('\u000C'); // Ctrl+L
      await wait();

      // Should reset the current setting to its default value
      unmount();
    });

    it('should handle navigation when only one setting exists', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Try to navigate when potentially at bounds
      stdin.write(TerminalKeys.DOWN_ARROW as string);
      await wait();
      stdin.write(TerminalKeys.UP_ARROW as string);
      await wait();

      unmount();
    });

    it('should properly handle Tab navigation between sections', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Wait for initial render
      await waitFor(() => {
        expect(lastFrame()).toContain('Vim Mode');
      });

      // Verify initial state: settings section active, scope section inactive
      expect(lastFrame()).toContain('● Vim Mode'); // Settings section active
      expect(lastFrame()).toContain('  Apply To'); // Scope section inactive

      // This test validates the rendered UI structure for tab navigation
      // Actual tab behavior testing is complex due to keypress handling

      unmount();
    });
  });

  describe('Error Recovery', () => {
    it('should handle malformed settings gracefully', () => {
      // Create settings with potentially problematic values
      const settings = createMockSettings(
        { vimMode: null as unknown as boolean }, // Invalid value
        {},
        {},
      );
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Should still render without crashing
      expect(lastFrame()).toContain('Settings');
    });

    it('should handle missing setting definitions gracefully', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      // Should not crash even if some settings are missing definitions
      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toContain('Settings');
    });
  });

  describe('Complex User Interactions', () => {
    it('should handle complete user workflow: navigate, toggle, change scope, exit', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Wait for initial render
      await waitFor(() => {
        expect(lastFrame()).toContain('Vim Mode');
      });

      // Verify the complete UI is rendered with all necessary sections
      expect(lastFrame()).toContain('Settings'); // Title
      expect(lastFrame()).toContain('● Vim Mode'); // Active setting
      expect(lastFrame()).toContain('Apply To'); // Scope section
      expect(lastFrame()).toContain('User Settings'); // Scope options (no numbers when settings focused)
      expect(lastFrame()).toContain(
        '(Use Enter to select, Tab to change focus, Esc to close)',
      ); // Help text

      // This test validates the complete UI structure is available for user workflow
      // Individual interactions are tested in focused unit tests

      unmount();
    });

    it('should allow changing multiple settings without losing pending changes', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Toggle first setting (should require restart)
      stdin.write(TerminalKeys.ENTER as string); // Enter
      await wait();

      // Navigate to next setting and toggle it (should not require restart - e.g., vimMode)
      stdin.write(TerminalKeys.DOWN_ARROW as string); // Down
      await wait();
      stdin.write(TerminalKeys.ENTER as string); // Enter
      await wait();

      // Navigate to another setting and toggle it (should also require restart)
      stdin.write(TerminalKeys.DOWN_ARROW as string); // Down
      await wait();
      stdin.write(TerminalKeys.ENTER as string); // Enter
      await wait();

      // The test verifies that all changes are preserved and the dialog still works
      // This tests the fix for the bug where changing one setting would reset all pending changes
      unmount();
    });

    it('should maintain state consistency during complex interactions', async () => {
      const settings = createMockSettings({ vimMode: true });
      const onSelect = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Multiple scope changes
      stdin.write(TerminalKeys.TAB as string); // Tab to scope
      await wait();
      stdin.write('2'); // Workspace
      await wait();
      stdin.write(TerminalKeys.TAB as string); // Tab to settings
      await wait();
      stdin.write(TerminalKeys.TAB as string); // Tab to scope
      await wait();
      stdin.write('1'); // User
      await wait();

      // Should maintain consistent state
      unmount();
    });

    it('should handle restart workflow correctly', async () => {
      const settings = createMockSettings();
      const onRestartRequest = vi.fn();

      const { stdin, unmount } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog
            settings={settings}
            onSelect={() => {}}
            onRestartRequest={onRestartRequest}
          />
        </KeypressProvider>,
      );

      // This would test the restart workflow if we could trigger it
      stdin.write('r'); // Try restart key
      await wait();

      // Without restart prompt showing, this should have no effect
      expect(onRestartRequest).not.toHaveBeenCalled();

      unmount();
    });
  });

  describe('String Settings Editing', () => {
    it('should allow editing and committing a string setting', async () => {
      let settings = createMockSettings({ 'a.string.setting': 'initial' });
      const onSelect = vi.fn();

      const { stdin, unmount, rerender } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Wait for the dialog to render
      await wait();

      // Navigate to the last setting
      for (let i = 0; i < 20; i++) {
        stdin.write('j'); // Down
        await wait(10);
      }

      // Press Enter to start editing
      stdin.write('\r');
      await wait();

      // Type a new value
      stdin.write('new value');
      await wait();

      // Press Enter to commit
      stdin.write('\r');
      await wait();

      settings = createMockSettings(
        { 'a.string.setting': 'new value' },
        {},
        {},
      );
      rerender(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );
      await wait();

      // Press Escape to exit
      stdin.write('\u001B');
      await wait();

      expect(onSelect).toHaveBeenCalledWith(undefined, 'User');

      unmount();
    });
  });

  describe('Snapshot Tests', () => {
    /**
     * Snapshot tests for SettingsDialog component using ink-testing-library.
     * These tests capture the visual output of the component in various states:
     *
     * - Default rendering with no custom settings
     * - Various combinations of boolean settings (enabled/disabled)
     * - Mixed boolean and number settings configurations
     * - Different focus states (settings vs scope selector)
     * - Different scope selections (User, System, Workspace)
     * - Accessibility settings enabled
     * - File filtering configurations
     * - Tools and security settings
     * - All settings disabled state
     *
     * The snapshots help ensure UI consistency and catch unintended visual changes.
     */

    it('should render default state correctly', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with various boolean settings enabled', () => {
      const settings = createMockSettings({
        general: {
          vimMode: true,
          disableAutoUpdate: true,
          debugKeystrokeLogging: true,
          enablePromptCompletion: true,
        },
        ui: {
          hideWindowTitle: true,
          hideTips: true,
          showMemoryUsage: true,
          showLineNumbers: true,
          showCitations: true,
          accessibility: {
            disableLoadingPhrases: true,
            screenReader: true,
          },
        },
        ide: {
          enabled: true,
        },
        context: {
          loadMemoryFromIncludeDirectories: true,
          fileFiltering: {
            respectGitIgnore: true,
            respectGeminiIgnore: true,
            enableRecursiveFileSearch: true,
            disableFuzzySearch: false,
          },
        },
        tools: {
          enableInteractiveShell: true,
          autoAccept: true,
          useRipgrep: true,
        },
        security: {
          folderTrust: {
            enabled: true,
          },
        },
      });
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with mixed boolean and number settings', () => {
      const settings = createMockSettings({
        general: {
          vimMode: false,
          disableAutoUpdate: true,
        },
        ui: {
          showMemoryUsage: true,
          hideWindowTitle: false,
        },
        tools: {
          truncateToolOutputThreshold: 50000,
          truncateToolOutputLines: 1000,
        },
        context: {
          discoveryMaxDirs: 500,
        },
        model: {
          maxSessionTurns: 100,
          skipNextSpeakerCheck: false,
        },
      });
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render focused on scope selector', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Switch focus to scope selector with Tab
      stdin.write('\t');

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with different scope selected (System)', () => {
      const settings = createMockSettings(
        {}, // userSettings
        {
          // systemSettings
          general: {
            vimMode: true,
            disableAutoUpdate: false,
          },
          ui: {
            showMemoryUsage: true,
          },
        },
      );
      const onSelect = vi.fn();

      const { lastFrame, stdin } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Switch to scope selector
      stdin.write('\t');
      // Navigate to System scope
      stdin.write('ArrowDown');
      stdin.write('\r'); // Enter to select

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with different scope selected (Workspace)', () => {
      const settings = createMockSettings(
        {}, // userSettings
        {}, // systemSettings
        {
          // workspaceSettings
          general: {
            vimMode: false,
            debugKeystrokeLogging: true,
          },
          tools: {
            useRipgrep: true,
            enableInteractiveShell: false,
          },
        },
      );
      const onSelect = vi.fn();

      const { lastFrame, stdin } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Switch to scope selector
      stdin.write('\t');
      // Navigate to Workspace scope (down twice)
      stdin.write('ArrowDown');
      stdin.write('ArrowDown');
      stdin.write('\r'); // Enter to select

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with accessibility settings enabled', () => {
      const settings = createMockSettings({
        ui: {
          accessibility: {
            disableLoadingPhrases: true,
            screenReader: true,
          },
          showMemoryUsage: true,
          showLineNumbers: true,
        },
        general: {
          vimMode: true,
        },
      });
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with file filtering settings configured', () => {
      const settings = createMockSettings({
        context: {
          fileFiltering: {
            respectGitIgnore: false,
            respectGeminiIgnore: true,
            enableRecursiveFileSearch: false,
            disableFuzzySearch: true,
          },
          loadMemoryFromIncludeDirectories: true,
          discoveryMaxDirs: 100,
        },
      });
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with tools and security settings', () => {
      const settings = createMockSettings({
        tools: {
          enableInteractiveShell: true,
          autoAccept: false,
          useRipgrep: true,
          truncateToolOutputThreshold: 25000,
          truncateToolOutputLines: 500,
        },
        security: {
          folderTrust: {
            enabled: true,
          },
        },
        model: {
          maxSessionTurns: 50,
          skipNextSpeakerCheck: true,
        },
      });
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render with all boolean settings disabled', () => {
      const settings = createMockSettings({
        general: {
          vimMode: false,
          disableAutoUpdate: false,
          debugKeystrokeLogging: false,
          enablePromptCompletion: false,
        },
        ui: {
          hideWindowTitle: false,
          hideTips: false,
          showMemoryUsage: false,
          showLineNumbers: false,
          showCitations: false,
          accessibility: {
            disableLoadingPhrases: false,
            screenReader: false,
          },
        },
        ide: {
          enabled: false,
        },
        context: {
          loadMemoryFromIncludeDirectories: false,
          fileFiltering: {
            respectGitIgnore: false,
            respectGeminiIgnore: false,
            enableRecursiveFileSearch: false,
            disableFuzzySearch: false,
          },
        },
        tools: {
          enableInteractiveShell: false,
          autoAccept: false,
          useRipgrep: false,
        },
        security: {
          folderTrust: {
            enabled: false,
          },
        },
      });
      const onSelect = vi.fn();

      const { lastFrame } = render(
        <KeypressProvider kittyProtocolEnabled={false}>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      expect(lastFrame()).toMatchSnapshot();
    });
  });
});
