/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SettingScope } from '../../config/settings.js';

describe('mcp remove command', () => {
  describe('integration tests (real files)', () => {
    let tempDir: string;
    let settingsPath: string;

    beforeEach(() => {
      // Create a temporary directory for test files
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-remove-test-'));
      const geminiDir = path.join(tempDir, '.gemini');
      fs.mkdirSync(geminiDir, { recursive: true });
      settingsPath = path.join(geminiDir, 'settings.json');
    });

    afterEach(() => {
      // Clean up temporary directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should actually remove server from settings.json file', async () => {
      // Import loadSettings dynamically to avoid mock issues
      const { loadSettings } = await import('../../config/settings.js');

      // Create initial settings with two servers
      const initialSettings = {
        mcpServers: {
          'test-server': {
            command: 'echo',
            args: ['hello'],
          },
          'keep-server': {
            command: 'echo',
            args: ['world'],
          },
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(initialSettings, null, 2));

      // Load settings and remove test-server
      const settings = loadSettings(tempDir);
      const existingSettings = settings.forScope(
        SettingScope.Workspace,
      ).settings;
      const mcpServers = existingSettings.mcpServers || {};

      delete mcpServers['test-server'];
      settings.setValue(SettingScope.Workspace, 'mcpServers', mcpServers);

      // Verify the file was actually updated
      const updatedContent = fs.readFileSync(settingsPath, 'utf-8');
      const updatedSettings = JSON.parse(updatedContent);

      expect(updatedSettings.mcpServers).toBeDefined();
      expect(updatedSettings.mcpServers['test-server']).toBeUndefined();
      expect(updatedSettings.mcpServers['keep-server']).toBeDefined();
      expect(updatedSettings.mcpServers['keep-server'].command).toBe('echo');
    });

    it('should preserve comments when removing a server', async () => {
      // Import loadSettings dynamically to avoid mock issues
      const { loadSettings } = await import('../../config/settings.js');

      // Create settings with comments
      const settingsWithComments = `{
  // MCP Server configuration
  "mcpServers": {
    // Server to remove
    "test-server": {
      "command": "echo",
      "args": ["hello"]
    },
    // Server to keep
    "keep-server": {
      "command": "echo",
      "args": ["world"]
    }
  }
}`;
      fs.writeFileSync(settingsPath, settingsWithComments);

      // Load settings and remove test-server
      const settings = loadSettings(tempDir);
      const existingSettings = settings.forScope(
        SettingScope.Workspace,
      ).settings;
      const mcpServers = existingSettings.mcpServers || {};

      delete mcpServers['test-server'];
      settings.setValue(SettingScope.Workspace, 'mcpServers', mcpServers);

      // Verify comments are preserved for kept server
      const updatedContent = fs.readFileSync(settingsPath, 'utf-8');

      expect(updatedContent).toContain('// MCP Server configuration');
      expect(updatedContent).toContain('// Server to keep');
      expect(updatedContent).not.toContain('// Server to remove');
      expect(updatedContent).not.toContain('test-server');
      expect(updatedContent).toContain('keep-server');
    });

    it('should handle removing all servers', async () => {
      // Import loadSettings dynamically to avoid mock issues
      const { loadSettings } = await import('../../config/settings.js');

      // Create initial settings with one server
      const initialSettings = {
        mcpServers: {
          'test-server': {
            command: 'echo',
            args: ['hello'],
          },
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(initialSettings, null, 2));

      // Load settings and remove the only server
      const settings = loadSettings(tempDir);
      const existingSettings = settings.forScope(
        SettingScope.Workspace,
      ).settings;
      const mcpServers = existingSettings.mcpServers || {};

      delete mcpServers['test-server'];
      settings.setValue(SettingScope.Workspace, 'mcpServers', mcpServers);

      // Verify mcpServers is now an empty object
      const updatedContent = fs.readFileSync(settingsPath, 'utf-8');
      const updatedSettings = JSON.parse(updatedContent);

      expect(updatedSettings.mcpServers).toBeDefined();
      expect(Object.keys(updatedSettings.mcpServers)).toHaveLength(0);
    });

    it('should only remove from specified scope', async () => {
      // Import loadSettings dynamically to avoid mock issues
      const { loadSettings } = await import('../../config/settings.js');

      // Create user settings
      const userGeminiDir = path.join(os.homedir(), '.gemini');
      const userSettingsPath = path.join(userGeminiDir, 'settings.json');
      const hasUserSettings = fs.existsSync(userSettingsPath);
      let originalUserSettings: string | null = null;

      if (hasUserSettings) {
        originalUserSettings = fs.readFileSync(userSettingsPath, 'utf-8');
      }

      try {
        // Set up workspace settings with a server
        const workspaceSettings = {
          mcpServers: {
            'workspace-server': {
              command: 'echo',
              args: ['workspace'],
            },
          },
        };
        fs.writeFileSync(
          settingsPath,
          JSON.stringify(workspaceSettings, null, 2),
        );

        // Remove from workspace scope
        const settings = loadSettings(tempDir);
        const workspaceSettingsObj = settings.forScope(
          SettingScope.Workspace,
        ).settings;
        const mcpServers = workspaceSettingsObj.mcpServers || {};

        delete mcpServers['workspace-server'];
        settings.setValue(SettingScope.Workspace, 'mcpServers', mcpServers);

        // Verify only workspace settings were modified
        const updatedContent = fs.readFileSync(settingsPath, 'utf-8');
        const updatedSettings = JSON.parse(updatedContent);

        expect(updatedSettings.mcpServers['workspace-server']).toBeUndefined();
      } finally {
        // Restore original user settings if they existed
        if (hasUserSettings && originalUserSettings) {
          fs.writeFileSync(userSettingsPath, originalUserSettings);
        }
      }
    });
  });
});
