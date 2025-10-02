/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { updateSettingsFilePreservingFormat } from './commentJson.js';

describe('commentJson', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preserve-format-test-'));
    testFilePath = path.join(tempDir, 'settings.json');
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('updateSettingsFilePreservingFormat', () => {
    it('should preserve comments when updating settings', () => {
      const originalContent = `{
        // Model configuration
        "model": "gemini-2.5-pro",
        "ui": {
          // Theme setting
          "theme": "dark"
        }
      }`;

      fs.writeFileSync(testFilePath, originalContent, 'utf-8');

      // updateSettingsFilePreservingFormat expects the complete settings object
      // because it's designed to be called from saveSettings which always passes
      // the complete originalSettings
      updateSettingsFilePreservingFormat(testFilePath, {
        model: 'gemini-2.5-flash',
        ui: {
          theme: 'dark',
        },
      });

      const updatedContent = fs.readFileSync(testFilePath, 'utf-8');

      expect(updatedContent).toContain('// Model configuration');
      expect(updatedContent).toContain('// Theme setting');
      expect(updatedContent).toContain('"model": "gemini-2.5-flash"');
      expect(updatedContent).toContain('"theme": "dark"');
    });

    it('should handle nested object updates', () => {
      const originalContent = `{
        "ui": {
          "theme": "dark",
          "showLineNumbers": true
        }
      }`;

      fs.writeFileSync(testFilePath, originalContent, 'utf-8');

      updateSettingsFilePreservingFormat(testFilePath, {
        ui: {
          theme: 'light',
          showLineNumbers: true,
        },
      });

      const updatedContent = fs.readFileSync(testFilePath, 'utf-8');
      expect(updatedContent).toContain('"theme": "light"');
      expect(updatedContent).toContain('"showLineNumbers": true');
    });

    it('should add new fields while preserving existing structure', () => {
      const originalContent = `{
        // Existing config
        "model": "gemini-2.5-pro"
      }`;

      fs.writeFileSync(testFilePath, originalContent, 'utf-8');

      updateSettingsFilePreservingFormat(testFilePath, {
        model: 'gemini-2.5-pro',
        newField: 'newValue',
      });

      const updatedContent = fs.readFileSync(testFilePath, 'utf-8');
      expect(updatedContent).toContain('// Existing config');
      expect(updatedContent).toContain('"newField": "newValue"');
    });

    it('should create file if it does not exist', () => {
      updateSettingsFilePreservingFormat(testFilePath, {
        model: 'gemini-2.5-pro',
      });

      expect(fs.existsSync(testFilePath)).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('"model": "gemini-2.5-pro"');
    });

    it('should handle complex real-world scenario', () => {
      const complexContent = `{
        // Settings
        "model": "gemini-2.5-pro",
        "mcpServers": {
          // Active server
          "context7": {
            "headers": {
              "API_KEY": "test-key" // API key
            }
          }
        }
      }`;

      fs.writeFileSync(testFilePath, complexContent, 'utf-8');

      updateSettingsFilePreservingFormat(testFilePath, {
        model: 'gemini-2.5-flash',
        mcpServers: {
          context7: {
            headers: {
              API_KEY: 'new-test-key',
            },
          },
        },
        newSection: {
          setting: 'value',
        },
      });

      const updatedContent = fs.readFileSync(testFilePath, 'utf-8');

      // Verify comments preserved
      expect(updatedContent).toContain('// Settings');
      expect(updatedContent).toContain('// Active server');
      expect(updatedContent).toContain('// API key');

      // Verify updates applied
      expect(updatedContent).toContain('"model": "gemini-2.5-flash"');
      expect(updatedContent).toContain('"newSection"');
      expect(updatedContent).toContain('"API_KEY": "new-test-key"');
    });

    it('should handle corrupted JSON files gracefully', () => {
      const corruptedContent = `{
        "model": "gemini-2.5-pro",
        "ui": {
          "theme": "dark"
        // Missing closing brace
      `;

      fs.writeFileSync(testFilePath, corruptedContent, 'utf-8');

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      expect(() => {
        updateSettingsFilePreservingFormat(testFilePath, {
          model: 'gemini-2.5-flash',
        });
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error parsing settings file:',
        expect.any(Error),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Settings file may be corrupted. Please check the JSON syntax.',
      );

      const unchangedContent = fs.readFileSync(testFilePath, 'utf-8');
      expect(unchangedContent).toBe(corruptedContent);

      consoleSpy.mockRestore();
    });

    it('should handle property deletions in nested objects', () => {
      const originalContent = `{
        "mcpServers": {
          // Server to keep
          "keep-server": {
            "command": "echo",
            "args": ["world"]
          },
          // Server to remove
          "test-server": {
            "command": "echo",
            "args": ["hello"]
          }
        }
      }`;

      fs.writeFileSync(testFilePath, originalContent, 'utf-8');

      updateSettingsFilePreservingFormat(testFilePath, {
        mcpServers: {
          'keep-server': {
            command: 'echo',
            args: ['world'],
          },
        },
      });

      const updatedContent = fs.readFileSync(testFilePath, 'utf-8');

      expect(updatedContent).toContain('// Server to keep');
      expect(updatedContent).toContain('"keep-server"');
      expect(updatedContent).not.toContain('test-server');
      expect(updatedContent).not.toContain('// Server to remove');
    });

    it('should handle complete property deletions at top level', () => {
      const originalContent = `{
        "model": "gemini-2.5-pro",
        "mcpServers": {
          "test": {
            "command": "test"
          }
        }
      }`;

      fs.writeFileSync(testFilePath, originalContent, 'utf-8');

      updateSettingsFilePreservingFormat(testFilePath, {
        model: 'gemini-2.5-flash',
      });

      const updatedContent = fs.readFileSync(testFilePath, 'utf-8');

      expect(updatedContent).toContain('"model": "gemini-2.5-flash"');
      expect(updatedContent).not.toContain('mcpServers');
      expect(updatedContent).not.toContain('test');
    });

    it('should handle deletion of deeply nested properties', () => {
      const originalContent = `{
        "ui": {
          "theme": "dark",
          "showLineNumbers": true,
          "deprecated": "value"
        }
      }`;

      fs.writeFileSync(testFilePath, originalContent, 'utf-8');

      updateSettingsFilePreservingFormat(testFilePath, {
        ui: {
          theme: 'light',
          showLineNumbers: false,
        },
      });

      const updatedContent = fs.readFileSync(testFilePath, 'utf-8');
      const parsed = JSON.parse(updatedContent);

      expect(parsed.ui.theme).toBe('light');
      expect(parsed.ui.showLineNumbers).toBe(false);
      expect(parsed.ui.deprecated).toBeUndefined();
    });
  });
});
