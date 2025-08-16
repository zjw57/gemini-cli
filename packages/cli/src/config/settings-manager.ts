/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MCPServerConfig } from '@google/gemini-cli-core';

export type ExtensionScope = 'user' | 'project';

export interface ExtensionMetadata {
  name: string;
  source: string;
  installDate: string;
  lastUpdated: string;
  active: boolean;
  scope: ExtensionScope;
}

interface SettingsFile {
  extensions?: Record<string, ExtensionMetadata>;
  mcpServers?: Record<string, MCPServerConfig>;
}

export class SettingsManager {
  private readonly settingsFile: string;

  constructor(scope: ExtensionScope = 'user') {
    if (scope === 'user') {
      this.settingsFile = path.join(os.homedir(), '.gemini', 'settings.json');
    } else {
      this.settingsFile = path.join(process.cwd(), '.gemini', 'settings.json');
    }
  }

  private async readSettings(): Promise<SettingsFile> {
    if (!fs.existsSync(this.settingsFile)) {
      return {};
    }
    const content = await fs.promises.readFile(this.settingsFile, 'utf-8');
    return JSON.parse(content) as SettingsFile;
  }

  private async writeSettings(settings: SettingsFile): Promise<void> {
    const dir = path.dirname(this.settingsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(
      this.settingsFile,
      JSON.stringify(settings, null, 2),
    );
  }

  async getInstalledExtensions(): Promise<ExtensionMetadata[]> {
    const settings = await this.readSettings();
    return Object.values(settings.extensions || {});
  }

  async getExtension(name: string): Promise<ExtensionMetadata | undefined> {
    const settings = await this.readSettings();
    return (settings.extensions || {})[name];
  }

  async addExtension(extension: ExtensionMetadata): Promise<void> {
    const settings = await this.readSettings();
    if (!settings.extensions) {
      settings.extensions = {};
    }
    settings.extensions[extension.name] = extension;
    await this.writeSettings(settings);
  }

  async removeExtension(name: string): Promise<void> {
    const settings = await this.readSettings();
    if (settings.extensions) {
      delete settings.extensions[name];
      await this.writeSettings(settings);
    }
  }

  async updateExtension(extension: ExtensionMetadata): Promise<void> {
    await this.addExtension(extension);
  }

  async getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    const settings = await this.readSettings();
    return settings.mcpServers || {};
  }

  async addMcpServer(name: string, config: MCPServerConfig): Promise<void> {
    const settings = await this.readSettings();
    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }
    settings.mcpServers[name] = config;
    await this.writeSettings(settings);
  }

  async removeMcpServer(name: string): Promise<void> {
    const settings = await this.readSettings();
    if (settings.mcpServers) {
      delete settings.mcpServers[name];
      await this.writeSettings(settings);
    }
  }
}
