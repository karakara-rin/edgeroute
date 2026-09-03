export interface ChatCompletionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null | Array<{ type: string; text?: string; [key: string]: unknown }>;
  tool_calls?: ChatCompletionToolCall[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type ChatCompletionToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
      type: 'function';
      function: {
        name: string;
      };
    };

export interface ChatCompletionResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name: string;
    description?: string;
    schema?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ChatCompletionRequestBody {
  model?: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  tools?: ChatCompletionTool[];
  tool_choice?: ChatCompletionToolChoice;
  response_format?: ChatCompletionResponseFormat;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  [key: string]: unknown;
}

export interface ChatCompletionChunkChoiceDelta {
  role?: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkChoiceDelta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  system_fingerprint?: string;
}

export interface RouteLogEvent {
  id?: string;
  timestamp?: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  fromCache?: boolean;
  cacheLatencyMs?: number;
  matchedRoute?: string;
  targetModel?: string;
  defaultModel?: string;
  provider?: string;
  savedCostUSD?: number;
  retriedWithFallback?: boolean;
  primaryModelError?: string | number;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

