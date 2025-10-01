// src/config.ts
export interface MCPServerConfig {
  name: string;
  url: string;
  description?: string;
  enabled?: boolean;
}

export interface AppConfig {
  mcpServers: MCPServerConfig[];
  gemini: {
    model: string;
    timeout: number;
  };
  client: {
    timeout: number;
    maxRetries: number;
    streamingChunkSize: number;
  };
}

export const defaultConfig: AppConfig = {
  mcpServers: [
    {
      name: "aws-knowledge-mcp-server",
      url: "https://knowledge-mcp.global.api.aws",
      description: "AWS Knowledge and Documentation Server",
      enabled: true
    }
  ],
  gemini: {
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
    timeout: 30000
  },
  client: {
    timeout: 30000,
    maxRetries: 3,
    streamingChunkSize: 50
  }
};

export function loadConfig(): AppConfig {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const configFile = fs.readFileSync(configPath, 'utf8');
      const userConfig = JSON.parse(configFile);
      
      return {
        ...defaultConfig,
        ...userConfig,
        mcpServers: userConfig.mcpServers || defaultConfig.mcpServers,
        gemini: { ...defaultConfig.gemini, ...userConfig.gemini },
        client: { ...defaultConfig.client, ...userConfig.client }
      };
    }
  } catch (error: any) {
    console.warn('⚠️  Could not load config.json, using defaults:', error.message || error);
  }
  
  return defaultConfig;
}