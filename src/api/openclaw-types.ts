/**
 * OpenClaw Plugin SDK type definitions.
 * Extracted from openclaw@2026.3.8 (dist/plugin-sdk/).
 *
 * At runtime, the OpenClaw gateway provides the real implementations.
 * These types let us compile a conformant plugin without importing
 * the full openclaw package (which has heavy native deps on Linux).
 */

import type { TSchema, Static } from '@sinclair/typebox';

// ── pi-agent-core types (@mariozechner/pi-agent-core) ─────

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
}

export interface AgentToolResult<T = unknown> {
  content: (TextContent | ImageContent)[];
  details: T;
}

export type AgentToolUpdateCallback<T = unknown> = (
  partialResult: AgentToolResult<T>,
) => void;

export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> {
  name: string;
  description: string;
  parameters: TParameters;
  label: string;
  ownerOnly?: boolean;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

export type AnyAgentTool = AgentTool<any, unknown> & { ownerOnly?: boolean };

/** Throw from execute() to signal bad input (LLM gets retry hint). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

/** Throw from execute() to block unauthorized callers. */
export class ToolAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolAuthorizationError';
  }
}

// ── Plugin Logger ─────────────────────────────────────────

export interface PluginLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

// ── Reply Payload ─────────────────────────────────────────

export interface ReplyPayload {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
  audioAsVoice?: boolean;
  isError?: boolean;
  isReasoning?: boolean;
  channelData?: Record<string, unknown>;
}

// ── Plugin Commands ───────────────────────────────────────

export interface PluginCommandContext {
  senderId?: string;
  senderIsOwner?: boolean;
  channel: string;
  channelId?: string;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: Record<string, unknown>;
}

export type PluginCommandHandler = (
  ctx: PluginCommandContext,
) => ReplyPayload | Promise<ReplyPayload>;

export interface OpenClawPluginCommandDefinition {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: PluginCommandHandler;
}

// ── Plugin Services ───────────────────────────────────────

export interface OpenClawPluginServiceContext {
  config: Record<string, unknown>;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
}

export interface OpenClawPluginService {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
}

// ── Plugin HTTP Routes ────────────────────────────────────

export interface OpenClawPluginHttpRouteParams {
  path: string;
  handler: (req: any, res: any) => Promise<boolean | void> | boolean | void;
  auth: 'gateway' | 'plugin';
  match?: 'exact' | 'prefix';
  replaceExisting?: boolean;
}

// ── Plugin Tool Factory ───────────────────────────────────

export interface OpenClawPluginToolContext {
  config?: Record<string, unknown>;
  sessionKey?: string;
  sessionId?: string;
  senderId?: string;
  senderIsOwner?: boolean;
}

export type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AgentTool<any> | AgentTool<any>[] | null | undefined;

// ── Plugin Runtime ────────────────────────────────────────

export interface SubagentRunParams {
  sessionKey: string;
  prompt: string;
  tools?: AnyAgentTool[];
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
}

export interface SubagentRunResult {
  text: string;
  toolResults?: AgentToolResult[];
}

export interface PluginRuntimeSubagent {
  run: (params: SubagentRunParams) => Promise<SubagentRunResult>;
  waitForRun: (params: SubagentRunParams & { timeout?: number }) => Promise<SubagentRunResult>;
}

export interface PluginRuntimeChannel {
  text: {
    chunk: (text: string, opts?: { maxLen?: number }) => string[];
  };
  reply: {
    send: (channelId: string, accountId: string, payload: ReplyPayload) => Promise<void>;
  };
}

export interface PluginRuntimeSystem {
  requestHeartbeatNow: () => void;
}

export interface PluginRuntimeState {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  set: <T = unknown>(key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export interface PluginRuntime {
  version: string;
  config: Record<string, unknown>;
  system: PluginRuntimeSystem;
  subagent: PluginRuntimeSubagent;
  channel: PluginRuntimeChannel;
  logging: { getChildLogger: (name: string) => PluginLogger };
  state: PluginRuntimeState;
  media?: unknown;
  tts?: unknown;
  stt?: unknown;
  tools?: unknown;
  events?: unknown;
}

// ── Plugin Lifecycle Hooks ────────────────────────────────

export type PluginHookName =
  | 'before_model_resolve'
  | 'llm_input'
  | 'llm_output'
  | 'message_received'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_error'
  | 'gateway_start'
  | 'gateway_stop'
  | 'heartbeat'
  | 'heartbeat_error'
  | 'config_changed'
  | 'channel_connected'
  | 'channel_disconnected'
  | 'channel_error'
  | 'session_start'
  | 'session_end'
  | 'subagent_spawned'
  | 'subagent_ended'
  | 'provider_auth_start'
  | 'provider_auth_end'
  | 'turn_start'
  | 'turn_end';

export interface PluginHookEvent {
  hookName: PluginHookName;
  timestamp: number;
  [key: string]: unknown;
}

// ── Plugin Config Schema ──────────────────────────────────

export interface OpenClawPluginConfigSchema {
  type: 'object';
  additionalProperties?: boolean;
  required?: string[];
  properties: Record<string, {
    type: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
  }>;
}

// ── Provider Plugin ───────────────────────────────────────

export interface ProviderPlugin {
  id: string;
  name: string;
  authMethods?: ProviderAuthMethod[];
}

export interface ProviderAuthMethod {
  id: string;
  label: string;
  fields: { key: string; label: string; type: 'text' | 'password'; required?: boolean }[];
}

// ── Main Plugin API ───────────────────────────────────────

export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;

  // Core registrations
  registerTool: (
    tool: AgentTool<any> | OpenClawPluginToolFactory,
    opts?: { name?: string; optional?: boolean; names?: string[] },
  ) => void;
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
  registerService: (service: OpenClawPluginService) => void;
  registerHttpRoute: (params: OpenClawPluginHttpRouteParams) => void;

  // Extended registrations
  registerChannel: (channel: any) => void;
  registerProvider: (provider: ProviderPlugin) => void;
  registerContextEngine: (engine: any) => void;
  registerGatewayMethod: (name: string, handler: (...args: any[]) => any) => void;
  registerCli: (commands: any) => void;

  // Lifecycle hooks
  registerHook: (
    events: PluginHookName | PluginHookName[],
    handler: (event: PluginHookEvent) => any,
    opts?: { name?: string },
  ) => void;
  on: (
    hookName: PluginHookName | string,
    handler: (event: PluginHookEvent) => any,
    opts?: { priority?: number },
  ) => void;

  // Utilities
  resolvePath: (input: string) => string;
}

// ── Plugin Definition ─────────────────────────────────────

export type PluginKind = 'memory' | 'context-engine';

export interface OpenClawPluginDefinition {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: PluginKind;
  configSchema?: OpenClawPluginConfigSchema;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
}

export type OpenClawPluginModule =
  | OpenClawPluginDefinition
  | ((api: OpenClawPluginApi) => void | Promise<void>);
