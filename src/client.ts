// src/client.ts
import fetch from "node-fetch";
import { Readable } from "stream";

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResponse {
  content?: Array<{ type: string; text: string }>;
  text?: string;
  [key: string]: any;
}

export class StreamableMCPClient {
  servers: Record<string, string>;
  private requestId = 1;
  private timeout: number;
  private maxRetries: number;

  constructor(
    servers: Record<string, string>, 
    options: { timeout?: number; maxRetries?: number } = {}
  ) {
    this.servers = servers;
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
  }

  private async makeRequest(url: string, payload: any, retryCount = 0): Promise<any> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "User-Agent": "StreamableMCPClient/1.0"
        },
        body: JSON.stringify(payload),
      });

      return response;
    } catch (error: any) {
      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        console.warn(`⚠️  Request failed, retrying (${retryCount + 1}/${this.maxRetries})...`);
        await this.delay(Math.pow(2, retryCount) * 1000);
        return this.makeRequest(url, payload, retryCount + 1);
      }
      throw error;
    }
  }

  private isRetryableError(error: any): boolean {
    return (
      error.name === 'AbortError' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      (error.response && error.response.status >= 500)
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private validateServerName(serverName: string): void {
    if (!this.servers[serverName]) {
      throw new Error(`Server '${serverName}' not found. Available servers: ${Object.keys(this.servers).join(', ')}`);
    }
  }

  async listTools(serverName: string): Promise<MCPTool[]> {
    this.validateServerName(serverName);
    const serverUrl = this.servers[serverName];
    
    try {
      const payload = {
        jsonrpc: "2.0",
        id: this.requestId++,
        method: "tools/list",
        params: {}
      };

      const response = await this.makeRequest(serverUrl, payload);
      
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText}. Body: ${body}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(`JSON-RPC Error (${result.error.code}): ${result.error.message}`);
      }

      const tools = result.result?.tools || [];
      console.log(`📋 Found ${tools.length} tools from ${serverName}`);
      return tools;
    } catch (error: any) {
      throw new Error(`Failed to fetch tools from ${serverName} (${serverUrl}): ${error.message || error}`);
    }
  }

  async callToolStream(
    serverName: string,
    tool: string,
    args: any,
    onData: (chunk: string) => void
  ): Promise<void> {
    this.validateServerName(serverName);
    const serverUrl = this.servers[serverName];
    
    try {
      const payload = {
        jsonrpc: "2.0",
        id: this.requestId++,
        method: "tools/call",
        params: {
          name: tool,
          arguments: args,
        }
      };

      const response = await this.makeRequest(serverUrl, payload);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText}. Body: ${body}`);
      }

      if (!response.body) {
        throw new Error("No response body from server");
      }

      const stream = Readable.from(response.body);
      let buffer = "";
      
      for await (const chunk of stream) {
        buffer += chunk.toString();
      }

      let result;
      try {
        result = JSON.parse(buffer);
      } catch (parseError: any) {
        throw new Error(`Invalid JSON response: ${parseError.message || parseError}. Response: ${buffer.substring(0, 200)}...`);
      }
      
      if (result.error) {
        throw new Error(`Tool Error (${result.error.code}): ${result.error.message}`);
      }

      await this.processToolResponse(result.result, onData);
      
    } catch (error: any) {
      throw new Error(`Failed to call tool '${tool}' on ${serverName}: ${error.message || error}`);
    }
  }

  private async processToolResponse(result: MCPResponse, onData: (chunk: string) => void): Promise<void> {
    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === "text" && item.text) {
          await this.streamText(item.text, onData);
        }
      }
    } else if (result.text) {
      await this.streamText(result.text, onData);
    } else {
      const fallbackText = JSON.stringify(result, null, 2);
      await this.streamText(fallbackText, onData);
    }
  }

  private async streamText(text: string, onData: (chunk: string) => void, chunkSize = 50): Promise<void> {
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.slice(i, i + chunkSize);
      onData(chunk);
      await this.delay(10);
    }
  }

  getServerNames(): string[] {
    return Object.keys(this.servers);
  }
}