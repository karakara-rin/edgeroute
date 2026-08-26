import type { EdgeRouteConfig, ProviderType } from '@edgeroute/core';

export interface ProviderRequestOptions {
  model: string;
  body: Record<string, unknown>;
  clientHeaders: Headers;
  config: EdgeRouteConfig;
}

export interface ProviderAdapter {
  readonly name: ProviderType;
  execute(options: ProviderRequestOptions): Promise<Response>;
}
