// src/index.ts
import { StreamableMCPClient } from "./client";
import { GoogleGenAI } from "@google/genai";
import { loadConfig, AppConfig } from "./config";
import * as readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
});

interface ToolChoice {
  shouldUseTool: boolean;
  tool?: string;
  args?: Record<string, any>;
  reasoning?: string;
}

class InteractiveMCPDemo {
  private client: StreamableMCPClient;
  private rl: readline.Interface;
  private availableTools: any[] = [];
  private config: AppConfig;

  constructor() {
    this.config = loadConfig();

    // Build servers object from config
    const servers: Record<string, string> = {};
    this.config.mcpServers
      .filter(server => server.enabled !== false)
      .forEach(server => {
        servers[server.name] = server.url;
      });

    this.client = new StreamableMCPClient(servers, {
      timeout: this.config.client.timeout,
      maxRetries: this.config.client.maxRetries
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async initialize() {
    console.log("🚀 Initializing MCP Demo...");
    try {
      this.availableTools = await this.client.listTools("aws-knowledge-mcp-server");
      console.log("📚 Available MCP tools loaded successfully");
      console.log("💡 Type 'help' to see available commands or 'quit' to exit\n");
    } catch (error) {
      console.error("❌ Failed to initialize MCP client:", error);
      throw error;
    }
  }

  private async askGeminiForToolChoice(userInput: string): Promise<ToolChoice> {
    const prompt = `
You are an AI assistant that can decide whether to use MCP (Model Context Protocol) tools to answer user questions.

Available MCP tools:
${JSON.stringify(this.availableTools, null, 2)}

User question: "${userInput}"

Analyze the user's question and decide:
1. Can this question be answered using the available MCP tools?
2. If yes, which tool should be used and with what arguments?
3. If no, explain why not.

Respond with ONLY a valid JSON object in this format:
{
  "shouldUseTool": true/false,
  "tool": "toolName" (if shouldUseTool is true),
  "args": {"param": "value"} (if shouldUseTool is true),
  "reasoning": "Brief explanation of your decision"
}

Do not include markdown formatting or additional text.
`;

    const response = await genAI.models.generateContent({
      model: this.config.gemini.model,
      contents: prompt,
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("No response from Gemini");
    }

    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();

    try {
      return JSON.parse(cleanedText);
    } catch (error) {
      console.error("❌ Failed to parse Gemini response:", cleanedText);
      throw new Error("Invalid JSON response from Gemini");
    }
  }

  private async handleDirectResponse(userInput: string): Promise<void> {
    console.log("🤖 Generating direct response...\n");

    const response = await genAI.models.generateContent({
      model: this.config.gemini.model,
      contents: userInput,
    });

    console.log("✅ Response:\n", response.text);
  }

  private async handleMCPToolCall(choice: ToolChoice): Promise<void> {
    if (!choice.tool || !choice.args) {
      throw new Error("Invalid tool choice");
    }

    console.log(`🔧 Using MCP tool: ${choice.tool}`);
    console.log(`📝 Reasoning: ${choice.reasoning}\n`);

    let streamedText = "";

    await this.client.callToolStream(
      "aws-knowledge-mcp-server",
      choice.tool,
      choice.args,
      (chunk) => {
        process.stdout.write(chunk);
        streamedText += chunk;
      }
    );

    // Generate a summary if the response is long
    if (streamedText.length > 500) {
      console.log("\n\n⏳ Generating summary...\n");

      const summaryPrompt = `
Summarize this MCP server response clearly and concisely:

${streamedText}

Focus on the key points that directly answer the user's question.
`;

      const summaryResponse = await genAI.models.generateContent({
        model: this.config.gemini.model,
        contents: summaryPrompt,
      });

      console.log("📋 Summary:\n", summaryResponse.text);
    }
  }

  private showHelp(): void {
    console.log(`
📖 Available commands:
  help     - Show this help message
  tools    - List available MCP tools
  quit     - Exit the application
  
💬 Or just ask any question! I'll decide whether to use MCP tools or respond directly.

Examples:
  "What is Amazon Bedrock?"
  "How does AWS Lambda work?"
  "Tell me about machine learning"
`);
  }

  private showTools(): void {
    console.log("📚 Available MCP Tools:");
    this.availableTools.forEach((tool, index) => {
      console.log(`${index + 1}. ${tool.name}`);
      if (tool.description) {
        console.log(`   Description: ${tool.description}`);
      }
      if (tool.inputSchema?.properties) {
        console.log(`   Parameters: ${Object.keys(tool.inputSchema.properties).join(', ')}`);
      }
      console.log();
    });
  }

  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  async run(): Promise<void> {
    await this.initialize();

    while (true) {
      try {
        const userInput = await this.question("💭 You: ");

        if (!userInput.trim()) continue;

        const input = userInput.trim().toLowerCase();

        if (input === 'quit' || input === 'exit') {
          console.log("👋 Goodbye!");
          break;
        }

        if (input === 'help') {
          this.showHelp();
          continue;
        }

        if (input === 'tools') {
          this.showTools();
          continue;
        }

        console.log("\n🤔 Analyzing your question...");

        const choice = await this.askGeminiForToolChoice(userInput);

        if (choice.shouldUseTool && choice.tool) {
          await this.handleMCPToolCall(choice);
        } else {
          console.log(`💡 ${choice.reasoning}\n`);
          await this.handleDirectResponse(userInput);
        }

        console.log("\n" + "─".repeat(50) + "\n");

      } catch (error) {
        console.error("❌ Error:", error);
        console.log("Please try again.\n");
      }
    }

    this.rl.close();
  }
}

async function main() {
  const demo = new InteractiveMCPDemo();
  await demo.run();
}

main().catch(console.error);