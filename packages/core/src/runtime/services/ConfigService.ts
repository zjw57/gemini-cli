/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApprovalMode } from '../../config/config.js';
import { IRuntimeConfig } from '../api/runtime-config.js';
import { AuthType } from '../api/auth-types.js';

const DEFAULT_MODEL_NAME = 'gemini-2.5-pro';

/**
 * A fully resolved and validated configuration object for internal use by the runtime.
 * It is the single source of truth for all other services within the runtime.
 */
interface IResolvedRuntimeConfig {
  auth: {
    type: AuthType;
    credentials?: unknown;
  };
  model: {
    name: string;
  };
  tools: {
    exclude: string[];
    approvalMode: ApprovalMode;
  };
  system: {
    proxy?: string;
  };
  debug: {
    enabled: boolean;
  };
}

/**
 * The internal interface for the ConfigService.
 */
export interface IConfigService {
  /**
   * Initializes the service by resolving the initial raw configuration
   * into a usable, defaulted state. This must be called before any
   * getters are used.
   */
  initialize(): Promise<void>;

  /** Retrieves the name of the currently configured model. */
  getModelName(): string;

  /** Checks if the application is running in debug mode. */
  isDebugMode(): boolean;

  /** Gets the configured tool approval mode. */
  getApprovalMode(): ApprovalMode;

  /** Retrieves the configured authentication type. */
  getAuthType(): AuthType;

  /** Retrieves the configured proxy URL, if any. */
  getProxy(): string | undefined;
}

/**
 * The ConfigService is the single source of truth for all application
 * configuration within the core runtime. It is responsible for taking the initial
 * raw configuration provided by the client (e.g., the CLI) and resolving it
 * into a complete, validated, and usable state for all other services.
 */
export class ConfigService implements IConfigService {
  private readonly initialConfig: IRuntimeConfig;
  private resolvedConfig!: IResolvedRuntimeConfig; // Asserted as non-null after initialization.
  private isInitialized = false;

  /**
   * Constructs a new ConfigService.
   * @param initialConfig The raw configuration object provided by the client.
   * This object is considered untrusted and will be validated and resolved.
   */
  constructor(initialConfig: IRuntimeConfig) {
    // We store a copy of the initial config. The service's main job is to
    // process this into the `resolvedConfig`.
    this.initialConfig = initialConfig;
  }

  public async initialize(): Promise<void> {
    this.resolvedConfig = this._resolveConfig(this.initialConfig);
    this.isInitialized = true;
    // In later phases, this method could also handle more complex
    // initialization, such as discovering extensions that might
    // modify the configuration.
  }

  public getModelName(): string {
    this.assertInitialized();
    return this.resolvedConfig.model.name;
  }

  public isDebugMode(): boolean {
    this.assertInitialized();
    return this.resolvedConfig.debug.enabled;
  }

  public getApprovalMode(): ApprovalMode {
    this.assertInitialized();
    return this.resolvedConfig.tools.approvalMode;
  }

  public getAuthType(): AuthType {
    this.assertInitialized();
    return this.resolvedConfig.auth.type;
  }

  public getProxy(): string | undefined {
    this.assertInitialized();
    return this.resolvedConfig.system.proxy;
  }

  /**
   * Ensures that the service has been initialized before allowing access
   * to configuration values, preventing race conditions.
   */
  private assertInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(
        'ConfigService has not been initialized. Please call initialize() before accessing configuration.',
      );
    }
  }

  /**
   * The core logic of the service. It takes the raw, potentially incomplete
   * client configuration and transforms it into the definitive, fully-populated
   * internal configuration object by applying defaults and mapping values.
   * @param config The raw IRuntimeConfig from the client.
   * @returns A fully resolved IResolvedRuntimeConfig.
   */
  private _resolveConfig(config: IRuntimeConfig): IResolvedRuntimeConfig {
    return {
      model: {
        name: config.model?.name || DEFAULT_MODEL_NAME,
      },
      debug: {
        enabled: config.debug?.enabled || false,
      },
      auth: {
        // We accept the auth config as-is for now. Phase 1 will add validation.
        type: config.auth?.type || AuthType.NONE,
        credentials: config.auth?.credentials,
      },
      tools: {
        exclude: config.tools?.exclude || [],
        approvalMode: this._mapApprovalMode(config.tools?.approvalMode),
      },
      system: {
        proxy: config.system?.proxy,
      },
    };
  }

  /**
   * Safely maps a string input to the ApprovalMode enum, providing a sensible default.
   * This is a perfect example of the service's role: to sanitize and validate
   * client input into a strongly-typed internal state.
   * @param mode The raw string from the client config.
   * @returns A valid ApprovalMode enum value.
   */
  private _mapApprovalMode(mode?: string): ApprovalMode {
    switch (mode?.toLowerCase()) {
      case 'autoEdit':
        return ApprovalMode.AUTO_EDIT;
      case 'yolo':
        return ApprovalMode.YOLO;
      default:
        return ApprovalMode.DEFAULT;
    }
  }
}