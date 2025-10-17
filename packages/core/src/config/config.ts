/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import process from 'node:process';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../core/contentGenerator.js';
import {
  AuthType,
  createContentGenerator,
  createContentGeneratorConfig,
} from '../core/contentGenerator.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { LSTool } from '../tools/ls.js';
import { ReadFileTool } from '../tools/read-file.js';
import { GrepTool } from '../tools/grep.js';
import { canUseRipgrep, RipGrepTool } from '../tools/ripGrep.js';
import { GlobTool } from '../tools/glob.js';
import { EditTool } from '../tools/edit.js';
import { SmartEditTool } from '../tools/smart-edit.js';
import { ShellTool } from '../tools/shell.js';
import { WriteFileTool } from '../tools/write-file.js';
import { WebFetchTool } from '../tools/web-fetch.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { MemoryTool, setGeminiMdFilename } from '../tools/memoryTool.js';
import { WebSearchTool } from '../tools/web-search.js';
import { GeminiClient } from '../core/client.js';
import { BaseLlmClient } from '../core/baseLlmClient.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { GitService } from '../services/gitService.js';
import type { TelemetryTarget } from '../telemetry/index.js';
import {
  initializeTelemetry,
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
  uiTelemetryService,
} from '../telemetry/index.js';
import { tokenLimit } from '../core/tokenLimits.js';
import { StartSessionEvent } from '../telemetry/index.js';
import {
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_THINKING_MODE,
} from './models.js';
import { shouldAttemptBrowserLaunch } from '../utils/browser.js';
import type { MCPOAuthConfig } from '../mcp/oauth-provider.js';
import { ideContextStore } from '../ide/ideContext.js';
import { WriteTodosTool } from '../tools/write-todos.js';
import type { FileSystemService } from '../services/fileSystemService.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import {
  logCliConfiguration,
  logRipgrepFallback,
} from '../telemetry/loggers.js';
import { RipgrepFallbackEvent } from '../telemetry/types.js';
import type { FallbackModelHandler } from '../fallback/types.js';
import { ModelRouterService } from '../routing/modelRouterService.js';
import { OutputFormat } from '../output/types.js';

// Re-export OAuth config type
export type { MCPOAuthConfig, AnyToolInvocation };
import type { AnyToolInvocation } from '../tools/tools.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { Storage } from './storage.js';
import type { ShellExecutionConfig } from '../services/shellExecutionService.js';
import { FileExclusions } from '../utils/ignorePatterns.js';
import type { EventEmitter } from 'node:events';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import type { PolicyEngineConfig } from '../policy/types.js';
import type { UserTierId } from '../code_assist/types.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import { AgentRegistry } from '../agents/registry.js';
import { SubagentToolWrapper } from '../agents/subagent-tool-wrapper.js';

export enum ApprovalMode {
  DEFAULT = 'default',
  AUTO_EDIT = 'autoEdit',
  YOLO = 'yolo',
}

export interface AccessibilitySettings {
  disableLoadingPhrases?: boolean;
  screenReader?: boolean;
}

export interface BugCommandSettings {
  urlTemplate: string;
}

export interface ChatCompressionSettings {
  contextPercentageThreshold?: number;
}

export interface SummarizeToolOutputSettings {
  tokenBudget?: number;
}

export interface TelemetrySettings {
  enabled?: boolean;
  target?: TelemetryTarget;
  otlpEndpoint?: string;
  otlpProtocol?: 'grpc' | 'http';
  logPrompts?: boolean;
  outfile?: string;
  useCollector?: boolean;
}

export interface OutputSettings {
  format?: OutputFormat;
}

export interface CodebaseInvestigatorSettings {
  enabled?: boolean;
  maxNumTurns?: number;
  maxTimeMinutes?: number;
  thinkingBudget?: number;
  model?: string;
}

/**
 * All information required in CLI to handle an extension. Defined in Core so
 * that the collection of loaded, active, and inactive extensions can be passed
 * around on the config object though Core does not use this information
 * directly.
 */
export interface GeminiCLIExtension {
  name: string;
  version: string;
  isActive: boolean;
  path: string;
  installMetadata?: ExtensionInstallMetadata;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFiles: string[];
  excludeTools?: string[];
}

export interface ExtensionInstallMetadata {
  source: string;
  type: 'git' | 'local' | 'link' | 'github-release';
  releaseTag?: string; // Only present for github-release installs.
  ref?: string;
  autoUpdate?: boolean;
  allowPreRelease?: boolean;
}

import type { FileFilteringOptions } from './constants.js';
import {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
} from './constants.js';

export type { FileFilteringOptions };
export {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
};

export const DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD = 4_000_000;
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES = 1000;

export class MCPServerConfig {
  constructor(
    // For stdio transport
    readonly command?: string,
    readonly args?: string[],
    readonly env?: Record<string, string>,
    readonly cwd?: string,
    // For sse transport
    readonly url?: string,
    // For streamable http transport
    readonly httpUrl?: string,
    readonly headers?: Record<string, string>,
    // For websocket transport
    readonly tcp?: string,
    // Common
    readonly timeout?: number,
    readonly trust?: boolean,
    // Metadata
    readonly description?: string,
    readonly includeTools?: string[],
    readonly excludeTools?: string[],
    readonly extensionName?: string,
    // OAuth configuration
    readonly oauth?: MCPOAuthConfig,
    readonly authProviderType?: AuthProviderType,
    // Service Account Configuration
    /* targetAudience format: CLIENT_ID.apps.googleusercontent.com */
    readonly targetAudience?: string,
    /* targetServiceAccount format: <service-account-name>@<project-num>.iam.gserviceaccount.com */
    readonly targetServiceAccount?: string,
  ) {}
}

export enum AuthProviderType {
  DYNAMIC_DISCOVERY = 'dynamic_discovery',
  GOOGLE_CREDENTIALS = 'google_credentials',
  SERVICE_ACCOUNT_IMPERSONATION = 'service_account_impersonation',
}

export interface SandboxConfig {
  command: 'docker' | 'podman' | 'sandbox-exec';
  image: string;
}

export interface ConfigParameters {
  sessionId: string;
  embeddingModel?: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  question?: string;

  coreTools?: string[];
  allowedTools?: string[];
  excludeTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  userMemory?: string;
  geminiMdFileCount?: number;
  geminiMdFilePaths?: string[];
  approvalMode?: ApprovalMode;
  showMemoryUsage?: boolean;
  contextFileName?: string | string[];
  accessibility?: AccessibilitySettings;
  telemetry?: TelemetrySettings;
  usageStatisticsEnabled?: boolean;
  fileFiltering?: {
    respectGitIgnore?: boolean;
    respectGeminiIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
    disableFuzzySearch?: boolean;
  };
  checkpointing?: boolean;
  proxy?: string;
  cwd: string;
  fileDiscoveryService?: FileDiscoveryService;
  includeDirectories?: string[];
  bugCommand?: BugCommandSettings;
  model: string;
  extensionContextFilePaths?: string[];
  maxSessionTurns?: number;
  experimentalZedIntegration?: boolean;
  listExtensions?: boolean;
  extensions?: GeminiCLIExtension[];
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  noBrowser?: boolean;
  summarizeToolOutput?: Record<string, SummarizeToolOutputSettings>;
  folderTrust?: boolean;
  ideMode?: boolean;
  loadMemoryFromIncludeDirectories?: boolean;
  chatCompression?: ChatCompressionSettings;
  interactive?: boolean;
  trustedFolder?: boolean;
  useRipgrep?: boolean;
  enableInteractiveShell?: boolean;
  skipNextSpeakerCheck?: boolean;
  shellExecutionConfig?: ShellExecutionConfig;
  extensionManagement?: boolean;
  enablePromptCompletion?: boolean;
  truncateToolOutputThreshold?: number;
  truncateToolOutputLines?: number;
  enableToolOutputTruncation?: boolean;
  eventEmitter?: EventEmitter;
  useSmartEdit?: boolean;
  useWriteTodos?: boolean;
  policyEngineConfig?: PolicyEngineConfig;
  output?: OutputSettings;
  useModelRouter?: boolean;
  enableMessageBusIntegration?: boolean;
  codebaseInvestigatorSettings?: CodebaseInvestigatorSettings;
  continueOnFailedApiCall?: boolean;
  retryFetchErrors?: boolean;
  enableShellOutputEfficiency?: boolean;
}

export class Config {
  private toolRegistry!: ToolRegistry;
  private promptRegistry!: PromptRegistry;
  private agentRegistry!: AgentRegistry;
  private readonly sessionId: string;
  private fileSystemService: FileSystemService;
  private contentGeneratorConfig!: ContentGeneratorConfig;
  private contentGenerator!: ContentGenerator;
  private readonly embeddingModel: string;
  private readonly sandbox: SandboxConfig | undefined;
  private readonly targetDir: string;
  private workspaceContext: WorkspaceContext;
  private readonly debugMode: boolean;
  private readonly question: string | undefined;

  private readonly coreTools: string[] | undefined;
  private readonly allowedTools: string[] | undefined;
  private readonly excludeTools: string[] | undefined;
  private readonly toolDiscoveryCommand: string | undefined;
  private readonly toolCallCommand: string | undefined;
  private readonly mcpServerCommand: string | undefined;
  private readonly mcpServers: Record<string, MCPServerConfig> | undefined;
  private userMemory: string;
  private geminiMdFileCount: number;
  private geminiMdFilePaths: string[];
  private approvalMode: ApprovalMode;
  private readonly showMemoryUsage: boolean;
  private readonly accessibility: AccessibilitySettings;
  private readonly telemetrySettings: TelemetrySettings;
  private readonly usageStatisticsEnabled: boolean;
  private geminiClient!: GeminiClient;
  private baseLlmClient!: BaseLlmClient;
  private modelRouterService: ModelRouterService;
  private readonly fileFiltering: {
    respectGitIgnore: boolean;
    respectGeminiIgnore: boolean;
    enableRecursiveFileSearch: boolean;
    disableFuzzySearch: boolean;
  };
  private fileDiscoveryService: FileDiscoveryService | null = null;
  private gitService: GitService | undefined = undefined;
  private readonly checkpointing: boolean;
  private readonly proxy: string | undefined;
  private readonly cwd: string;
  private readonly bugCommand: BugCommandSettings | undefined;
  private model: string;
  private readonly extensionContextFilePaths: string[];
  private readonly noBrowser: boolean;
  private readonly folderTrust: boolean;
  private ideMode: boolean;

  private inFallbackMode = false;
  private readonly maxSessionTurns: number;
  private readonly listExtensions: boolean;
  private readonly _extensions: GeminiCLIExtension[];
  private readonly _blockedMcpServers: Array<{
    name: string;
    extensionName: string;
  }>;
  fallbackModelHandler?: FallbackModelHandler;
  private quotaErrorOccurred: boolean = false;
  private readonly summarizeToolOutput:
    | Record<string, SummarizeToolOutputSettings>
    | undefined;
  private readonly experimentalZedIntegration: boolean = false;
  private readonly loadMemoryFromIncludeDirectories: boolean = false;
  private readonly chatCompression: ChatCompressionSettings | undefined;
  private readonly interactive: boolean;
  private readonly trustedFolder: boolean | undefined;
  private readonly useRipgrep: boolean;
  private readonly enableInteractiveShell: boolean;
  private readonly skipNextSpeakerCheck: boolean;
  private shellExecutionConfig: ShellExecutionConfig;
  private readonly extensionManagement: boolean = true;
  private readonly enablePromptCompletion: boolean = false;
  private readonly truncateToolOutputThreshold: number;
  private readonly truncateToolOutputLines: number;
  private readonly enableToolOutputTruncation: boolean;
  private initialized: boolean = false;
  readonly storage: Storage;
  private readonly fileExclusions: FileExclusions;
  private readonly eventEmitter?: EventEmitter;
  private readonly useSmartEdit: boolean;
  private readonly useWriteTodos: boolean;
  private readonly messageBus: MessageBus;
  private readonly policyEngine: PolicyEngine;
  private readonly outputSettings: OutputSettings;
  private readonly useModelRouter: boolean;
  private readonly enableMessageBusIntegration: boolean;
  private readonly codebaseInvestigatorSettings: CodebaseInvestigatorSettings;
  private readonly continueOnFailedApiCall: boolean;
  private readonly retryFetchErrors: boolean;
  private readonly enableShellOutputEfficiency: boolean;

  constructor(params: ConfigParameters) {
    this.sessionId = params.sessionId;
    this.embeddingModel =
      params.embeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL;
    this.fileSystemService = new StandardFileSystemService();
    this.sandbox = params.sandbox;
    this.targetDir = path.resolve(params.targetDir);
    this.workspaceContext = new WorkspaceContext(
      this.targetDir,
      params.includeDirectories ?? [],
    );
    this.debugMode = params.debugMode;
    this.question = params.question;

    this.coreTools = params.coreTools;
    this.allowedTools = params.allowedTools;
    this.excludeTools = params.excludeTools;
    this.toolDiscoveryCommand = params.toolDiscoveryCommand;
    this.toolCallCommand = params.toolCallCommand;
    this.mcpServerCommand = params.mcpServerCommand;
    this.mcpServers = params.mcpServers;
    this.userMemory = params.userMemory ?? '';
    this.geminiMdFileCount = params.geminiMdFileCount ?? 0;
    this.geminiMdFilePaths = params.geminiMdFilePaths ?? [];
    this.approvalMode = params.approvalMode ?? ApprovalMode.DEFAULT;
    this.showMemoryUsage = params.showMemoryUsage ?? false;
    this.accessibility = params.accessibility ?? {};
    this.telemetrySettings = {
      enabled: params.telemetry?.enabled ?? false,
      target: params.telemetry?.target ?? DEFAULT_TELEMETRY_TARGET,
      otlpEndpoint: params.telemetry?.otlpEndpoint ?? DEFAULT_OTLP_ENDPOINT,
      otlpProtocol: params.telemetry?.otlpProtocol,
      logPrompts: params.telemetry?.logPrompts ?? true,
      outfile: params.telemetry?.outfile,
      useCollector: params.telemetry?.useCollector,
    };
    this.usageStatisticsEnabled = params.usageStatisticsEnabled ?? true;

    this.fileFiltering = {
      respectGitIgnore:
        params.fileFiltering?.respectGitIgnore ??
        DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
      respectGeminiIgnore:
        params.fileFiltering?.respectGeminiIgnore ??
        DEFAULT_FILE_FILTERING_OPTIONS.respectGeminiIgnore,
      enableRecursiveFileSearch:
        params.fileFiltering?.enableRecursiveFileSearch ?? true,
      disableFuzzySearch: params.fileFiltering?.disableFuzzySearch ?? false,
    };
    this.checkpointing = params.checkpointing ?? false;
    this.proxy = params.proxy;
    this.cwd = params.cwd ?? process.cwd();
    this.fileDiscoveryService = params.fileDiscoveryService ?? null;
    this.bugCommand = params.bugCommand;
    this.model = params.model;
    this.extensionContextFilePaths = params.extensionContextFilePaths ?? [];
    this.maxSessionTurns = params.maxSessionTurns ?? -1;
    this.experimentalZedIntegration =
      params.experimentalZedIntegration ?? false;
    this.listExtensions = params.listExtensions ?? false;
    this._extensions = params.extensions ?? [];
    this._blockedMcpServers = params.blockedMcpServers ?? [];
    this.noBrowser = params.noBrowser ?? false;
    this.summarizeToolOutput = params.summarizeToolOutput;
    this.folderTrust = params.folderTrust ?? false;
    this.ideMode = params.ideMode ?? false;
    this.loadMemoryFromIncludeDirectories =
      params.loadMemoryFromIncludeDirectories ?? false;
    this.chatCompression = params.chatCompression;
    this.interactive = params.interactive ?? false;
    this.trustedFolder = params.trustedFolder;
    this.useRipgrep = params.useRipgrep ?? true;
    this.enableInteractiveShell = params.enableInteractiveShell ?? false;
    this.skipNextSpeakerCheck = params.skipNextSpeakerCheck ?? true;
    this.shellExecutionConfig = {
      terminalWidth: params.shellExecutionConfig?.terminalWidth ?? 80,
      terminalHeight: params.shellExecutionConfig?.terminalHeight ?? 24,
      showColor: params.shellExecutionConfig?.showColor ?? false,
      pager: params.shellExecutionConfig?.pager ?? 'cat',
    };
    this.truncateToolOutputThreshold =
      params.truncateToolOutputThreshold ??
      DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD;
    this.truncateToolOutputLines =
      params.truncateToolOutputLines ?? DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES;
    this.enableToolOutputTruncation = params.enableToolOutputTruncation ?? true;
    this.useSmartEdit = params.useSmartEdit ?? true;
    this.useWriteTodos = params.useWriteTodos ?? false;
    this.useModelRouter = params.useModelRouter ?? false;
    this.enableMessageBusIntegration =
      params.enableMessageBusIntegration ?? false;
    this.codebaseInvestigatorSettings = {
      enabled: params.codebaseInvestigatorSettings?.enabled ?? true,
      maxNumTurns: params.codebaseInvestigatorSettings?.maxNumTurns ?? 15,
      maxTimeMinutes: params.codebaseInvestigatorSettings?.maxTimeMinutes ?? 5,
      thinkingBudget:
        params.codebaseInvestigatorSettings?.thinkingBudget ??
        DEFAULT_THINKING_MODE,
      model: params.codebaseInvestigatorSettings?.model ?? DEFAULT_GEMINI_MODEL,
    };
    this.continueOnFailedApiCall = params.continueOnFailedApiCall ?? true;
    this.enableShellOutputEfficiency =
      params.enableShellOutputEfficiency ?? true;
    this.extensionManagement = params.extensionManagement ?? true;
    this.storage = new Storage(this.targetDir);
    this.enablePromptCompletion = params.enablePromptCompletion ?? false;
    this.fileExclusions = new FileExclusions(this);
    this.eventEmitter = params.eventEmitter;
    this.policyEngine = new PolicyEngine(params.policyEngineConfig);
    this.messageBus = new MessageBus(this.policyEngine);
    this.outputSettings = {
      format: params.output?.format ?? OutputFormat.TEXT,
    };
    this.retryFetchErrors = params.retryFetchErrors ?? false;

    if (params.contextFileName) {
      setGeminiMdFilename(params.contextFileName);
    }

    if (this.telemetrySettings.enabled) {
      initializeTelemetry(this);
    }

    if (this.getProxy()) {
      setGlobalDispatcher(new ProxyAgent(this.getProxy() as string));
    }
    this.geminiClient = new GeminiClient(this);
    this.modelRouterService = new ModelRouterService(this);
  }

  /**
   * Must only be called once, throws if called again.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw Error('Config was already initialized');
    }
    this.initialized = true;

    // Initialize centralized FileDiscoveryService
    this.getFileService();
    if (this.getCheckpointingEnabled()) {
      await this.getGitService();
    }
    this.promptRegistry = new PromptRegistry();

    this.agentRegistry = new AgentRegistry(this);
    await this.agentRegistry.initialize();

    this.toolRegistry = await this.createToolRegistry();

    await this.geminiClient.initialize();
  }

  getContentGenerator(): ContentGenerator {
    return this.contentGenerator;
  }

  async refreshAuth(authMethod: AuthType) {
    // Vertex and Genai have incompatible encryption and sending history with
    // throughtSignature from Genai to Vertex will fail, we need to strip them
    if (
      this.contentGeneratorConfig?.authType === AuthType.USE_GEMINI &&
      authMethod === AuthType.LOGIN_WITH_GOOGLE
    ) {
      // Restore the conversation history to the new client
      this.geminiClient.stripThoughtsFromHistory();
    }

    const newContentGeneratorConfig = createContentGeneratorConfig(
      this,
      authMethod,
    );
    this.contentGenerator = await createContentGenerator(
      newContentGeneratorConfig,
      this,
      this.getSessionId(),
    );
    // Only assign to instance properties after successful initialization
    this.contentGeneratorConfig = newContentGeneratorConfig;

    // Initialize BaseLlmClient now that the ContentGenerator is available
    this.baseLlmClient = new BaseLlmClient(this.contentGenerator, this);

    // Reset the session flag since we're explicitly changing auth and using default model
    this.inFallbackMode = false;

    // Logging the cli configuration here as the auth related configuration params would have been loaded by this point
    logCliConfiguration(this, new StartSessionEvent(this, this.toolRegistry));
  }

  getUserTier(): UserTierId | undefined {
    return this.contentGenerator?.userTier;
  }

  /**
   * Provides access to the BaseLlmClient for stateless LLM operations.
   */
  getBaseLlmClient(): BaseLlmClient {
    if (!this.baseLlmClient) {
      // Handle cases where initialization might be deferred or authentication failed
      if (this.contentGenerator) {
        this.baseLlmClient = new BaseLlmClient(
          this.getContentGenerator(),
          this,
        );
      } else {
        throw new Error(
          'BaseLlmClient not initialized. Ensure authentication has occurred and ContentGenerator is ready.',
        );
      }
    }
    return this.baseLlmClient;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  shouldLoadMemoryFromIncludeDirectories(): boolean {
    return this.loadMemoryFromIncludeDirectories;
  }

  getContentGeneratorConfig(): ContentGeneratorConfig {
    return this.contentGeneratorConfig;
  }

  getModel(): string {
    return this.model;
  }

  setModel(newModel: string): void {
    // Do not allow Pro usage if the user is in fallback mode.
    if (newModel.includes('pro') && this.isInFallbackMode()) {
      return;
    }

    this.model = newModel;
  }

  isInFallbackMode(): boolean {
    return this.inFallbackMode;
  }

  setFallbackMode(active: boolean): void {
    this.inFallbackMode = active;
  }

  setFallbackModelHandler(handler: FallbackModelHandler): void {
    this.fallbackModelHandler = handler;
  }

  getMaxSessionTurns(): number {
    return this.maxSessionTurns;
  }

  setQuotaErrorOccurred(value: boolean): void {
    this.quotaErrorOccurred = value;
  }

  getQuotaErrorOccurred(): boolean {
    return this.quotaErrorOccurred;
  }

  getEmbeddingModel(): string {
    return this.embeddingModel;
  }

  getSandbox(): SandboxConfig | undefined {
    return this.sandbox;
  }

  isRestrictiveSandbox(): boolean {
    const sandboxConfig = this.getSandbox();
    const seatbeltProfile = process.env['SEATBELT_PROFILE'];
    return (
      !!sandboxConfig &&
      sandboxConfig.command === 'sandbox-exec' &&
      !!seatbeltProfile &&
      seatbeltProfile.startsWith('restrictive-')
    );
  }

  getTargetDir(): string {
    return this.targetDir;
  }

  getProjectRoot(): string {
    return this.targetDir;
  }

  getWorkspaceContext(): WorkspaceContext {
    return this.workspaceContext;
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getPromptRegistry(): PromptRegistry {
    return this.promptRegistry;
  }

  getDebugMode(): boolean {
    return this.debugMode;
  }
  getQuestion(): string | undefined {
    return this.question;
  }

  getCoreTools(): string[] | undefined {
    return this.coreTools;
  }

  getAllowedTools(): string[] | undefined {
    return this.allowedTools;
  }

  getExcludeTools(): string[] | undefined {
    return this.excludeTools;
  }

  getToolDiscoveryCommand(): string | undefined {
    return this.toolDiscoveryCommand;
  }

  getToolCallCommand(): string | undefined {
    return this.toolCallCommand;
  }

  getMcpServerCommand(): string | undefined {
    return this.mcpServerCommand;
  }

  getMcpServers(): Record<string, MCPServerConfig> | undefined {
    return this.mcpServers;
  }

  getUserMemory(): string {
    return this.userMemory;
  }

  setUserMemory(newUserMemory: string): void {
    this.userMemory = newUserMemory;
  }

  getGeminiMdFileCount(): number {
    return this.geminiMdFileCount;
  }

  setGeminiMdFileCount(count: number): void {
    this.geminiMdFileCount = count;
  }

  getGeminiMdFilePaths(): string[] {
    return this.geminiMdFilePaths;
  }

  setGeminiMdFilePaths(paths: string[]): void {
    this.geminiMdFilePaths = paths;
  }

  getApprovalMode(): ApprovalMode {
    return this.approvalMode;
  }

  setApprovalMode(mode: ApprovalMode): void {
    if (!this.isTrustedFolder() && mode !== ApprovalMode.DEFAULT) {
      throw new Error(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );
    }
    this.approvalMode = mode;
  }

  getShowMemoryUsage(): boolean {
    return this.showMemoryUsage;
  }

  getAccessibility(): AccessibilitySettings {
    return this.accessibility;
  }

  getTelemetryEnabled(): boolean {
    return this.telemetrySettings.enabled ?? false;
  }

  getTelemetryLogPromptsEnabled(): boolean {
    return this.telemetrySettings.logPrompts ?? true;
  }

  getTelemetryOtlpEndpoint(): string {
    return this.telemetrySettings.otlpEndpoint ?? DEFAULT_OTLP_ENDPOINT;
  }

  getTelemetryOtlpProtocol(): 'grpc' | 'http' {
    return this.telemetrySettings.otlpProtocol ?? 'grpc';
  }

  getTelemetryTarget(): TelemetryTarget {
    return this.telemetrySettings.target ?? DEFAULT_TELEMETRY_TARGET;
  }

  getTelemetryOutfile(): string | undefined {
    return this.telemetrySettings.outfile;
  }

  getTelemetryUseCollector(): boolean {
    return this.telemetrySettings.useCollector ?? false;
  }

  getGeminiClient(): GeminiClient {
    return this.geminiClient;
  }

  getModelRouterService(): ModelRouterService {
    return this.modelRouterService;
  }

  getEnableRecursiveFileSearch(): boolean {
    return this.fileFiltering.enableRecursiveFileSearch;
  }

  getFileFilteringDisableFuzzySearch(): boolean {
    return this.fileFiltering.disableFuzzySearch;
  }

  getFileFilteringRespectGitIgnore(): boolean {
    return this.fileFiltering.respectGitIgnore;
  }
  getFileFilteringRespectGeminiIgnore(): boolean {
    return this.fileFiltering.respectGeminiIgnore;
  }

  getFileFilteringOptions(): FileFilteringOptions {
    return {
      respectGitIgnore: this.fileFiltering.respectGitIgnore,
      respectGeminiIgnore: this.fileFiltering.respectGeminiIgnore,
    };
  }

  /**
   * Gets custom file exclusion patterns from configuration.
   * TODO: This is a placeholder implementation. In the future, this could
   * read from settings files, CLI arguments, or environment variables.
   */
  getCustomExcludes(): string[] {
    // Placeholder implementation - returns empty array for now
    // Future implementation could read from:
    // - User settings file
    // - Project-specific configuration
    // - Environment variables
    // - CLI arguments
    return [];
  }

  getCheckpointingEnabled(): boolean {
    return this.checkpointing;
  }

  getProxy(): string | undefined {
    return this.proxy;
  }

  getWorkingDir(): string {
    return this.cwd;
  }

  getBugCommand(): BugCommandSettings | undefined {
    return this.bugCommand;
  }

  getFileService(): FileDiscoveryService {
    if (!this.fileDiscoveryService) {
      this.fileDiscoveryService = new FileDiscoveryService(this.targetDir);
    }
    return this.fileDiscoveryService;
  }

  getUsageStatisticsEnabled(): boolean {
    return this.usageStatisticsEnabled;
  }

  getExtensionContextFilePaths(): string[] {
    return this.extensionContextFilePaths;
  }

  getExperimentalZedIntegration(): boolean {
    return this.experimentalZedIntegration;
  }

  getListExtensions(): boolean {
    return this.listExtensions;
  }

  getExtensionManagement(): boolean {
    return this.extensionManagement;
  }

  getExtensions(): GeminiCLIExtension[] {
    return this._extensions;
  }

  getBlockedMcpServers(): Array<{ name: string; extensionName: string }> {
    return this._blockedMcpServers;
  }

  getNoBrowser(): boolean {
    return this.noBrowser;
  }

  isBrowserLaunchSuppressed(): boolean {
    return this.getNoBrowser() || !shouldAttemptBrowserLaunch();
  }

  getSummarizeToolOutputConfig():
    | Record<string, SummarizeToolOutputSettings>
    | undefined {
    return this.summarizeToolOutput;
  }

  getIdeMode(): boolean {
    return this.ideMode;
  }

  /**
   * Returns 'true' if the folder trust feature is enabled.
   */
  getFolderTrust(): boolean {
    return this.folderTrust;
  }

  /**
   * Returns 'true' if the workspace is considered "trusted".
   * 'false' for untrusted.
   */
  isTrustedFolder(): boolean {
    // isWorkspaceTrusted in cli/src/config/trustedFolder.js returns undefined
    // when the file based trust value is unavailable, since it is mainly used
    // in the initialization for trust dialogs, etc. Here we return true since
    // config.isTrustedFolder() is used for the main business logic of blocking
    // tool calls etc in the rest of the application.
    //
    // Default value is true since we load with trusted settings to avoid
    // restarts in the more common path. If the user chooses to mark the folder
    // as untrusted, the CLI will restart and we will have the trust value
    // reloaded.
    const context = ideContextStore.get();
    if (context?.workspaceState?.isTrusted !== undefined) {
      return context.workspaceState.isTrusted;
    }

    return this.trustedFolder ?? true;
  }

  setIdeMode(value: boolean): void {
    this.ideMode = value;
  }

  /**
   * Get the current FileSystemService
   */
  getFileSystemService(): FileSystemService {
    return this.fileSystemService;
  }

  /**
   * Set a custom FileSystemService
   */
  setFileSystemService(fileSystemService: FileSystemService): void {
    this.fileSystemService = fileSystemService;
  }

  getChatCompression(): ChatCompressionSettings | undefined {
    return this.chatCompression;
  }

  isInteractive(): boolean {
    return this.interactive;
  }

  getUseRipgrep(): boolean {
    return this.useRipgrep;
  }

  getEnableInteractiveShell(): boolean {
    return this.enableInteractiveShell;
  }

  getSkipNextSpeakerCheck(): boolean {
    return this.skipNextSpeakerCheck;
  }

  getContinueOnFailedApiCall(): boolean {
    return this.continueOnFailedApiCall;
  }

  getRetryFetchErrors(): boolean {
    return this.retryFetchErrors;
  }

  getEnableShellOutputEfficiency(): boolean {
    return this.enableShellOutputEfficiency;
  }

  getShellExecutionConfig(): ShellExecutionConfig {
    return this.shellExecutionConfig;
  }

  setShellExecutionConfig(config: ShellExecutionConfig): void {
    this.shellExecutionConfig = {
      terminalWidth:
        config.terminalWidth ?? this.shellExecutionConfig.terminalWidth,
      terminalHeight:
        config.terminalHeight ?? this.shellExecutionConfig.terminalHeight,
      showColor: config.showColor ?? this.shellExecutionConfig.showColor,
      pager: config.pager ?? this.shellExecutionConfig.pager,
    };
  }
  getScreenReader(): boolean {
    return this.accessibility.screenReader ?? false;
  }

  getEnablePromptCompletion(): boolean {
    return this.enablePromptCompletion;
  }

  getEnableToolOutputTruncation(): boolean {
    return this.enableToolOutputTruncation;
  }

  getTruncateToolOutputThreshold(): number {
    return Math.min(
      // Estimate remaining context window in characters (1 token ~= 4 chars).
      4 *
        (tokenLimit(this.model) - uiTelemetryService.getLastPromptTokenCount()),
      this.truncateToolOutputThreshold,
    );
  }

  getTruncateToolOutputLines(): number {
    return this.truncateToolOutputLines;
  }

  getUseSmartEdit(): boolean {
    return this.useSmartEdit;
  }

  getUseWriteTodos(): boolean {
    return this.useWriteTodos;
  }

  getOutputFormat(): OutputFormat {
    return this.outputSettings?.format
      ? this.outputSettings.format
      : OutputFormat.TEXT;
  }

  getUseModelRouter(): boolean {
    return this.useModelRouter;
  }

  async getGitService(): Promise<GitService> {
    if (!this.gitService) {
      this.gitService = new GitService(this.targetDir, this.storage);
      await this.gitService.initialize();
    }
    return this.gitService;
  }

  getFileExclusions(): FileExclusions {
    return this.fileExclusions;
  }

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  getEnableMessageBusIntegration(): boolean {
    return this.enableMessageBusIntegration;
  }

  getCodebaseInvestigatorSettings(): CodebaseInvestigatorSettings {
    return this.codebaseInvestigatorSettings;
  }

  async createToolRegistry(): Promise<ToolRegistry> {
    const registry = new ToolRegistry(this, this.eventEmitter);

    // helper to create & register core tools that are enabled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registerCoreTool = (ToolClass: any, ...args: unknown[]) => {
      const className = ToolClass.name;
      const toolName = ToolClass.Name || className;
      const coreTools = this.getCoreTools();
      const excludeTools = this.getExcludeTools() || [];
      // On some platforms, the className can be minified to _ClassName.
      const normalizedClassName = className.replace(/^_+/, '');

      let isEnabled = true; // Enabled by default if coreTools is not set.
      if (coreTools) {
        isEnabled = coreTools.some(
          (tool) =>
            tool === toolName ||
            tool === normalizedClassName ||
            tool.startsWith(`${toolName}(`) ||
            tool.startsWith(`${normalizedClassName}(`),
        );
      }

      const isExcluded = excludeTools.some(
        (tool) => tool === toolName || tool === normalizedClassName,
      );

      if (isExcluded) {
        isEnabled = false;
      }

      if (isEnabled) {
        // Pass message bus to tools when feature flag is enabled
        // This first implementation is only focused on the general case of
        // the tool registry.
        const messageBusEnabled = this.getEnableMessageBusIntegration();
        if (this.debugMode && messageBusEnabled) {
          console.log(
            `[DEBUG] enableMessageBusIntegration setting: ${messageBusEnabled}`,
          );
        }
        const toolArgs = messageBusEnabled
          ? [...args, this.getMessageBus()]
          : args;
        if (this.debugMode && messageBusEnabled) {
          console.log(
            `[DEBUG] Registering ${className} with messageBus: ${messageBusEnabled ? 'YES' : 'NO'}`,
          );
        }
        registry.registerTool(new ToolClass(...toolArgs));
      }
    };

    registerCoreTool(LSTool, this);
    registerCoreTool(ReadFileTool, this);

    if (this.getUseRipgrep()) {
      let useRipgrep = false;
      let errorString: undefined | string = undefined;
      try {
        useRipgrep = await canUseRipgrep();
      } catch (error: unknown) {
        errorString = String(error);
      }
      if (useRipgrep) {
        registerCoreTool(RipGrepTool, this);
      } else {
        logRipgrepFallback(this, new RipgrepFallbackEvent(errorString));
        registerCoreTool(GrepTool, this);
      }
    } else {
      registerCoreTool(GrepTool, this);
    }

    registerCoreTool(GlobTool, this);
    if (this.getUseSmartEdit()) {
      registerCoreTool(SmartEditTool, this);
    } else {
      registerCoreTool(EditTool, this);
    }
    registerCoreTool(WriteFileTool, this);
    registerCoreTool(WebFetchTool, this);
    registerCoreTool(ReadManyFilesTool, this);
    registerCoreTool(ShellTool, this);
    registerCoreTool(MemoryTool);
    registerCoreTool(WebSearchTool, this);
    if (this.getUseWriteTodos()) {
      registerCoreTool(WriteTodosTool, this);
    }

    // Register Subagents as Tools
    if (this.getCodebaseInvestigatorSettings().enabled) {
      const definition = this.agentRegistry.getDefinition(
        'codebase_investigator',
      );
      if (definition) {
        // We must respect the main allowed/exclude lists for agents too.
        const excludeTools = this.getExcludeTools() || [];
        const allowedTools = this.getAllowedTools();

        const isExcluded = excludeTools.includes(definition.name);
        const isAllowed =
          !allowedTools || allowedTools.includes(definition.name);

        if (isAllowed && !isExcluded) {
          try {
            const messageBusEnabled = this.getEnableMessageBusIntegration();
            const wrapper = new SubagentToolWrapper(
              definition,
              this,
              messageBusEnabled ? this.getMessageBus() : undefined,
            );
            registry.registerTool(wrapper);
          } catch (error) {
            console.error(
              `Failed to wrap agent '${definition.name}' as a tool:`,
              error,
            );
          }
        } else if (this.getDebugMode()) {
          console.log(
            `[Config] Skipping registration of agent '${definition.name}' due to allow/exclude configuration.`,
          );
        }
      }
    }

    await registry.discoverAllTools();
    return registry;
  }
}
// Export model constants for use in CLI
export { DEFAULT_GEMINI_FLASH_MODEL };
