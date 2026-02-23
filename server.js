import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
const PORT = process.env.PORT || 3001;
const N8N_BASE_URL = process.env.N8N_BASE_URL || "http://localhost:5678";
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const USER_EMAIL = process.env.USER_EMAIL || "your-email@example.com";
const SMTP_CREDENTIAL_ID = process.env.SMTP_CREDENTIAL_ID || "";
const SHELL_ENABLED = (process.env.SHELL_ENABLED || "true").toLowerCase() === "true";
const SHELL_WORKING_DIR = process.env.SHELL_WORKING_DIR || process.env.HOME || "/";
const SHELL_TIMEOUT_MS = parseInt(process.env.SHELL_TIMEOUT_MS || "30000", 10);
const execAsync = promisify(exec);
const n8nClient = axios.create({
  baseURL: N8N_BASE_URL,
  headers: {
    "X-N8N-API-KEY": N8N_API_KEY,
    "Content-Type": "application/json",
  },
});
function registerHandlers(server) {
// List all available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Workflow Management
      {
        name: "list_workflows",
        description: "List all n8n workflows with their IDs, names, node count, and status",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_workflow_details",
        description: "Get detailed information about a specific workflow including all nodes and connections",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string", description: "The ID of the workflow" },
          },
          required: ["workflow_id"],
        },
      },
      {
        name: "create_workflow",
        description: "Create a new workflow with optional initial nodes",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Workflow name" },
            description: { type: "string", description: "Workflow description (optional)" },
          },
          required: ["name"],
        },
      },
      {
        name: "delete_workflow",
        description: "Permanently delete a workflow by ID",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string", description: "The workflow ID to delete" },
          },
          required: ["workflow_id"],
        },
      },
      {
        name: "activate_workflow",
        description: "Activate or deactivate a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            active: { type: "boolean" },
          },
          required: ["workflow_id", "active"],
        },
      },
      // Node Management
      {
        name: "add_node_to_workflow",
        description: "Add a new node to a workflow with specified configuration",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string", description: "The workflow ID" },
            node_name: { type: "string", description: "Name of the node (e.g., 'Webhook', 'HTTP Request')" },
            node_type: { type: "string", description: "Node type identifier (e.g., '@n8n/n8n-nodes-base.webhook')" },
            position: {
              type: "array",
              items: { type: "number" },
              description: "Position [x, y] on canvas"
            },
            config: {
              type: "object",
              description: "Node configuration parameters"
            },
            credentials: {
              type: "object",
              description: "Credentials to attach (e.g., { smtpAuth: { id: 'abc', name: 'SMTP account' } })"
            },
          },
          required: ["workflow_id", "node_name", "node_type", "position"],
        },
      },
      {
        name: "remove_node_from_workflow",
        description: "Remove a node from a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            node_name: { type: "string", description: "Name of the node to remove" },
          },
          required: ["workflow_id", "node_name"],
        },
      },
      {
        name: "update_node",
        description: "Update a node's configuration and/or credentials in a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            node_name: { type: "string" },
            config: { type: "object", description: "Updated parameters configuration" },
            credentials: {
              type: "object",
              description: "Credentials to set (e.g., { smtpAuth: { id: 'abc', name: 'SMTP account' } })"
            },
          },
          required: ["workflow_id", "node_name"],
        },
      },
      {
        name: "connect_nodes",
        description: "Create a connection between two nodes in a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            from_node: { type: "string", description: "Source node name" },
            to_node: { type: "string", description: "Target node name" },
            from_output: { type: "string", description: "Output type (default: 'main')", default: "main" },
          },
          required: ["workflow_id", "from_node", "to_node"],
        },
      },
      // Workflow Execution
      {
        name: "execute_workflow",
        description: "Execute/run a workflow immediately and return the execution ID. Works with any trigger type including Manual Trigger.",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string", description: "The workflow ID to execute" },
          },
          required: ["workflow_id"],
        },
      },
      {
        name: "get_execution_result",
        description: "Get the detailed result/output data of a specific execution",
        inputSchema: {
          type: "object",
          properties: {
            execution_id: { type: "string", description: "The execution ID to retrieve" },
          },
          required: ["execution_id"],
        },
      },
      {
        name: "get_workflow_executions",
        description: "Get execution history for a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            limit: { type: "number", description: "Max executions to return", default: 10 },
          },
          required: ["workflow_id"],
        },
      },
      // Webhook Management
      {
        name: "create_webhook",
        description: "Create a webhook for a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            path: { type: "string", description: "Webhook path (e.g., 'my-webhook')" },
          },
          required: ["workflow_id", "path"],
        },
      },
      {
        name: "list_webhooks",
        description: "List all webhooks for a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
          },
          required: ["workflow_id"],
        },
      },
      {
        name: "get_webhook_logs",
        description: "Get webhook execution logs",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            limit: { type: "number", default: 20 },
          },
          required: ["workflow_id"],
        },
      },
      // Credentials Management
      {
        name: "list_credentials",
        description: "List all available API credentials/connections",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "create_credential",
        description: "Create a new API credential/connection",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Credential name" },
            type: { type: "string", description: "Credential type (e.g., 'httpBasicAuth', 'oAuth2')" },
            data: { type: "object", description: "Credential data (API keys, tokens, etc.)" },
          },
          required: ["name", "type", "data"],
        },
      },
      // Variables Management
      {
        name: "list_variables",
        description: "List all workflow variables",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "set_variable",
        description: "Set a workflow variable",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "Variable name" },
            value: { type: "string", description: "Variable value" },
          },
          required: ["key", "value"],
        },
      },
      {
        name: "get_variable",
        description: "Get a workflow variable value",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "Variable name" },
          },
          required: ["key"],
        },
      },
      // Schedule Management
      {
        name: "list_schedules",
        description: "List all workflow schedules/triggers",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "set_schedule",
        description: "Set a cron schedule for a workflow. Adds or updates a Schedule Trigger node with the given cron expression.",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            cron: { type: "string", description: "Cron expression (e.g., '0 9 * * *' for 9 AM daily)" },
          },
          required: ["workflow_id", "cron"],
        },
      },
      // Email Notification
      {
        name: "send_result_email",
        description: "Send workflow results via email using SMTP",
        inputSchema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body (can include HTML)" },
            to_email: { type: "string", description: "Recipient email", default: USER_EMAIL },
          },
          required: ["subject", "body"],
        },
      },
      // Full Workflow Update
      {
        name: "update_workflow",
        description: "Update a workflow by replacing its entire definition via PUT. Pass the complete workflow JSON (nodes, connections, name, settings). Use get_workflow_details first to get the current state, modify it, then pass it here.",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string", description: "The workflow ID to update" },
            workflow_json: { type: "string", description: "Complete workflow JSON string with nodes, connections, name, settings" },
          },
          required: ["workflow_id", "workflow_json"],
        },
      },
      // Disconnect Nodes
      {
        name: "disconnect_nodes",
        description: "Remove a connection between two nodes in a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string", description: "The workflow ID" },
            from_node: { type: "string", description: "Source node name" },
            to_node: { type: "string", description: "Target node name" },
          },
          required: ["workflow_id", "from_node", "to_node"],
        },
      },
      // ============ SERVER SHELL & FILESYSTEM TOOLS ============
      ...(SHELL_ENABLED ? [
      {
        name: "run_command",
        description: "Execute a shell command on the server. Returns stdout, stderr, and exit code. Use for any CLI operation: git, docker, systemctl, apt, npm, etc.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to execute" },
            working_dir: { type: "string", description: "Working directory (default: SHELL_WORKING_DIR env var)" },
            timeout_ms: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
          },
          required: ["command"],
        },
      },
      {
        name: "read_file",
        description: "Read the contents of a file on the server",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Absolute or relative path to the file" },
            encoding: { type: "string", description: "File encoding (default: utf-8)", default: "utf-8" },
          },
          required: ["file_path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file on the server. Creates the file if it doesn't exist, overwrites if it does.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Absolute or relative path to the file" },
            content: { type: "string", description: "Content to write" },
            append: { type: "boolean", description: "Append instead of overwrite (default: false)", default: false },
          },
          required: ["file_path", "content"],
        },
      },
      {
        name: "list_directory",
        description: "List files and directories at a given path with details (size, modified date, type)",
        inputSchema: {
          type: "object",
          properties: {
            dir_path: { type: "string", description: "Directory path (default: SHELL_WORKING_DIR)" },
          },
          required: [],
        },
      },
      {
        name: "create_directory",
        description: "Create a directory (and parent directories if needed)",
        inputSchema: {
          type: "object",
          properties: {
            dir_path: { type: "string", description: "Directory path to create" },
          },
          required: ["dir_path"],
        },
      },
      {
        name: "move_file",
        description: "Move or rename a file or directory",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string", description: "Source path" },
            destination: { type: "string", description: "Destination path" },
          },
          required: ["source", "destination"],
        },
      },
      {
        name: "copy_file",
        description: "Copy a file or directory",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string", description: "Source path" },
            destination: { type: "string", description: "Destination path" },
            recursive: { type: "boolean", description: "Copy directories recursively (default: false)", default: false },
          },
          required: ["source", "destination"],
        },
      },
      {
        name: "delete_file",
        description: "Delete a file or directory",
        inputSchema: {
          type: "object",
          properties: {
            target_path: { type: "string", description: "Path to delete" },
            recursive: { type: "boolean", description: "Delete directories recursively (default: false)", default: false },
          },
          required: ["target_path"],
        },
      },
      {
        name: "file_info",
        description: "Get detailed info about a file or directory (size, permissions, owner, modified date)",
        inputSchema: {
          type: "object",
          properties: {
            target_path: { type: "string", description: "Path to inspect" },
          },
          required: ["target_path"],
        },
      },
      ] : []),
    ],
  };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    // ============ WORKFLOW QUERIES ============
    if (name === "list_workflows") {
      const response = await n8nClient.get("/api/v1/workflows");
      const workflows = response.data.data || [];
      const filtered = workflows.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        nodes: w.nodes?.length || 0,
        createdAt: w.createdAt,
      }));
      return {
        content: [
          {
            type: "text",
            text: `Found ${filtered.length} workflows:\n\n${JSON.stringify(filtered, null, 2)}`,
          },
        ],
      };
    }
    if (name === "get_workflow_details") {
      const { workflow_id } = args;
      const response = await n8nClient.get(`/api/v1/workflows/${workflow_id}`);
      const workflow = response.data;
      return {
        content: [
          {
            type: "text",
            text: `Workflow: ${workflow.name}\n\n${JSON.stringify(
              {
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                active: workflow.active,
                nodeCount: workflow.nodes?.length || 0,
                nodes: workflow.nodes?.map((n) => ({
                  id: n.id,
                  name: n.name,
                  type: n.type,
                  position: n.position,
                  credentials: n.credentials || undefined,
                })),
                connections: workflow.connections,
              },
              null,
              2
            )}`,
          },
        ],
      };
    }
    // ============ NODE MANAGEMENT ============
    // Helper: save workflow via PUT, preserving active state and staticData
    async function saveWorkflow(workflow_id, workflow) {
      const payload = {
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings || {},
      };
      // Preserve active state so saving doesn't silently deactivate
      if (workflow.active !== undefined) {
        payload.active = workflow.active;
      }
      if (workflow.staticData) {
        payload.staticData = workflow.staticData;
      }
      return n8nClient.put(`/api/v1/workflows/${workflow_id}`, payload);
    }

    if (name === "add_node_to_workflow") {
      const { workflow_id, node_name, node_type, position, config = {}, credentials } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      const newNode = {
        id: crypto.randomUUID(),
        name: node_name,
        type: node_type,
        position: position || [100, 100],
        parameters: config,
        typeVersion: 1,
      };
      // Attach credentials if provided
      if (credentials) {
        newNode.credentials = credentials;
      }
      workflow.nodes.push(newNode);
      await saveWorkflow(workflow_id, workflow);
      return {
        content: [
          {
            type: "text",
            text: `Added node "${node_name}" (${node_type}) to workflow${credentials ? " with credentials" : ""}`,
          },
        ],
      };
    }
    if (name === "remove_node_from_workflow") {
      const { workflow_id, node_name } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      workflow.nodes = workflow.nodes.filter((n) => n.name !== node_name);
      // Also remove connections referencing this node
      delete workflow.connections[node_name];
      for (const key of Object.keys(workflow.connections)) {
        for (const output of Object.keys(workflow.connections[key])) {
          workflow.connections[key][output] = workflow.connections[key][output].map(
            (arr) => arr.filter((c) => c.node !== node_name)
          );
        }
      }
      await saveWorkflow(workflow_id, workflow);
      return {
        content: [{ type: "text", text: `Removed node "${node_name}"` }],
      };
    }
    if (name === "update_node") {
      const { workflow_id, node_name, config, credentials } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      const node = workflow.nodes.find((n) => n.name === node_name);
      if (!node) throw new Error(`Node "${node_name}" not found`);
      // Update parameters if config provided
      if (config) {
        node.parameters = { ...node.parameters, ...config };
      }
      // Update credentials if provided
      if (credentials) {
        node.credentials = { ...node.credentials, ...credentials };
      }
      await saveWorkflow(workflow_id, workflow);
      const updates = [];
      if (config) updates.push("parameters");
      if (credentials) updates.push("credentials");
      return {
        content: [{ type: "text", text: `Updated node "${node_name}" ${updates.join(" and ")}` }],
      };
    }
    if (name === "connect_nodes") {
      const { workflow_id, from_node, to_node, from_output = "main" } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      if (!workflow.connections[from_node]) {
        workflow.connections[from_node] = {};
      }
      if (!workflow.connections[from_node][from_output]) {
        workflow.connections[from_node][from_output] = [[]];
      }
      workflow.connections[from_node][from_output][0].push({
        node: to_node,
        type: from_output,
        index: 0,
      });
      await saveWorkflow(workflow_id, workflow);
      return {
        content: [{ type: "text", text: `Connected "${from_node}" \u2192 "${to_node}"` }],
      };
    }
    // ============ WORKFLOW EXECUTION ============
    if (name === "execute_workflow") {
      const { workflow_id } = args;
      // Strategy: try multiple n8n API endpoints for execution
      // n8n CE has different endpoints across versions
      const errors = [];

      // Attempt 1: POST /api/v1/executions (n8n >= 1.x with execution API)
      try {
        const response = await n8nClient.post("/api/v1/executions", {
          workflowId: workflow_id,
        });
        const execution = response.data;
        return {
          content: [
            {
              type: "text",
              text: `Workflow executed!\n\nExecution ID: ${execution.data?.id || execution.id}\nStatus: ${execution.data?.status || execution.status || "running"}\n\nUse get_execution_result with the execution ID to see the output.`,
            },
          ],
        };
      } catch (e1) {
        errors.push(`POST /executions: ${e1.response?.status} ${e1.response?.data?.message || e1.message}`);
      }

      // Attempt 2: POST /api/v1/workflows/{id}/run (public API run endpoint, some versions)
      try {
        const response = await n8nClient.post(`/api/v1/workflows/${workflow_id}/run`);
        const execution = response.data;
        return {
          content: [
            {
              type: "text",
              text: `Workflow executed!\n\nExecution ID: ${execution.data?.executionId || execution.executionId || execution.data?.id || "unknown"}\nStatus: running\n\nUse get_execution_result with the execution ID to see the output.`,
            },
          ],
        };
      } catch (e2) {
        errors.push(`POST /api/v1/workflows/run: ${e2.response?.status} ${e2.response?.data?.message || e2.message}`);
      }

      // Attempt 3: Webhook-based execution (if workflow has a webhook node)
      try {
        const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
        const webhookNode = workflow.nodes.find((n) => n.type.includes("webhook"));
        if (webhookNode) {
          const path = webhookNode.parameters?.path || workflow_id;
          const httpMethod = (webhookNode.parameters?.httpMethod || "POST").toUpperCase();
          const webhookUrl = `${N8N_BASE_URL}/webhook/${path}`;
          const response = httpMethod === "GET"
            ? await axios.get(webhookUrl)
            : await axios.post(webhookUrl, { trigger: "mcp" });
          return {
            content: [
              {
                type: "text",
                text: `Workflow executed via webhook!\n\nWebhook URL: ${webhookUrl}\nMethod: ${httpMethod}\nResponse: ${JSON.stringify(response.data, null, 2)}`,
              },
            ],
          };
        }
      } catch (e3) {
        errors.push(`Webhook fallback: ${e3.response?.status || ""} ${e3.response?.data?.message || e3.message}`);
      }

      // Attempt 4: Create a temporary webhook-triggered wrapper workflow that
      // uses the Execute Workflow node to run the target workflow
      try {
        const wrapperPath = `_exec_${workflow_id}_${Date.now()}`;
        const wrapperNodes = [
          {
            id: crypto.randomUUID(),
            name: "Webhook",
            type: "n8n-nodes-base.webhook",
            position: [0, 0],
            parameters: { path: wrapperPath, httpMethod: "GET", responseMode: "lastNode" },
            typeVersion: 2,
            webhookId: crypto.randomUUID(),
          },
          {
            id: crypto.randomUUID(),
            name: "Execute Target",
            type: "n8n-nodes-base.executeWorkflow",
            position: [300, 0],
            parameters: { workflowId: { value: workflow_id }, mode: "once" },
            typeVersion: 1,
          },
        ];
        const wrapperWf = await n8nClient.post("/api/v1/workflows", {
          name: `_auto_exec_${Date.now()}`,
          nodes: wrapperNodes,
          connections: {
            Webhook: { main: [[{ node: "Execute Target", type: "main", index: 0 }]] },
          },
          settings: {},
        });
        const wrapperId = wrapperWf.data.id;

        // Activate it so webhook registers
        try {
          await n8nClient.post(`/api/v1/workflows/${wrapperId}/activate`);
        } catch {
          // Try PUT fallback
          const wf = (await n8nClient.get(`/api/v1/workflows/${wrapperId}`)).data;
          wf.active = true;
          await n8nClient.put(`/api/v1/workflows/${wrapperId}`, {
            name: wf.name, nodes: wf.nodes, connections: wf.connections,
            settings: wf.settings || {}, active: true,
          });
        }

        // Small delay for webhook registration
        await new Promise(r => setTimeout(r, 1000));

        // Trigger via webhook
        const webhookUrl = `${N8N_BASE_URL}/webhook/${wrapperPath}`;
        const execResponse = await axios.get(webhookUrl);

        // Cleanup wrapper
        try {
          await n8nClient.post(`/api/v1/workflows/${wrapperId}/deactivate`).catch(() => {});
          await n8nClient.delete(`/api/v1/workflows/${wrapperId}`);
        } catch {}

        return {
          content: [
            {
              type: "text",
              text: `Workflow executed via wrapper!\n\nTarget: ${workflow_id}\nResponse: ${JSON.stringify(execResponse.data, null, 2)}\n(wrapper workflow cleaned up)`,
            },
          ],
        };
      } catch (e4) {
        errors.push(`Wrapper execution: ${e4.response?.status || ""} ${e4.response?.data?.message || e4.message}`);
      }

      throw new Error(
        `Could not execute workflow ${workflow_id}. All methods failed:\n${errors.join("\n")}\n\nTip: Ensure the workflow is saved and has a Manual Trigger or Webhook node.`
      );
    }
    if (name === "get_execution_result") {
      const { execution_id } = args;
      const response = await n8nClient.get(`/api/v1/executions/${execution_id}`);
      const execution = response.data;
      // Extract output data from the last node that ran
      const resultData = execution.data?.resultData;
      let output = null;
      if (resultData?.runData) {
        const nodeNames = Object.keys(resultData.runData);
        const lastNode = nodeNames[nodeNames.length - 1];
        if (lastNode && resultData.runData[lastNode]) {
          const runs = resultData.runData[lastNode];
          const lastRun = runs[runs.length - 1];
          output = lastRun?.data?.main?.[0] || lastRun;
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Execution ${execution_id}:\n\nStatus: ${execution.status || execution.data?.status}\nStarted: ${execution.startedAt}\nFinished: ${execution.stoppedAt}\nWorkflow: ${execution.workflowId}\n\n${
              output
                ? `Output (last node):\n${JSON.stringify(output, null, 2)}`
                : `Full result data:\n${JSON.stringify(resultData, null, 2)}`
            }`,
          },
        ],
      };
    }
    if (name === "get_workflow_executions") {
      const { workflow_id, limit = 10 } = args;
      const response = await n8nClient.get(`/api/v1/executions?workflowId=${workflow_id}`);
      const executions = (response.data.data || []).slice(0, limit);
      return {
        content: [
          {
            type: "text",
            text: `Executions for workflow ${workflow_id}:\n\n${JSON.stringify(
              executions.map((e) => ({
                id: e.id,
                status: e.status,
                startedAt: e.startedAt,
                stoppedAt: e.stoppedAt,
              })),
              null,
              2
            )}`,
          },
        ],
      };
    }
    // ============ WEBHOOK MANAGEMENT ============
    if (name === "create_webhook") {
      const { workflow_id, path } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      // Check if a webhook node already exists
      const existing = workflow.nodes.find((n) => n.type.includes("webhook"));
      if (existing) {
        // Update the existing webhook node's path
        existing.parameters = { ...existing.parameters, path };
        await saveWorkflow(workflow_id, workflow);
        return {
          content: [{
            type: "text",
            text: `Updated existing webhook node path to "${path}".\n\nURL: ${N8N_BASE_URL}/webhook/${path}\n(Activate the workflow to register the webhook)`,
          }],
        };
      }
      // Add a new Webhook trigger node
      const webhookNode = {
        id: crypto.randomUUID(),
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        position: [0, 0],
        parameters: { path, httpMethod: "POST", responseMode: "onReceived" },
        typeVersion: 2,
        webhookId: crypto.randomUUID(),
      };
      workflow.nodes.push(webhookNode);
      await saveWorkflow(workflow_id, workflow);
      const webhookUrl = `${N8N_BASE_URL}/webhook/${path}`;
      return {
        content: [{
          type: "text",
          text: `Webhook node added to workflow!\n\nURL: ${webhookUrl}\nNode: "Webhook"\n(Activate the workflow to register the webhook)`,
        }],
      };
    }
    if (name === "list_webhooks") {
      const { workflow_id } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      const webhookNodes = workflow.nodes.filter((n) => n.type.includes("webhook"));
      return {
        content: [
          {
            type: "text",
            text: `Webhooks in workflow:\n\n${JSON.stringify(webhookNodes, null, 2)}`,
          },
        ],
      };
    }
    if (name === "get_webhook_logs") {
      const { workflow_id, limit = 20 } = args;
      // Fetch recent executions for this workflow as webhook logs
      const response = await n8nClient.get(`/api/v1/executions?workflowId=${workflow_id}`);
      const executions = (response.data.data || []).slice(0, limit);
      return {
        content: [
          {
            type: "text",
            text: `Recent executions for workflow ${workflow_id}:\n\n${JSON.stringify(
              executions.map((e) => ({
                id: e.id,
                status: e.status,
                startedAt: e.startedAt,
                stoppedAt: e.stoppedAt,
                mode: e.mode,
              })),
              null,
              2
            )}`,
          },
        ],
      };
    }
    // ============ CREDENTIALS ============
    if (name === "list_credentials") {
      // Try the credentials API first (works on newer n8n versions)
      try {
        const response = await n8nClient.get("/api/v1/credentials");
        const credentials = response.data.data || [];
        return {
          content: [
            {
              type: "text",
              text: `Found ${credentials.length} credentials:\n\n${JSON.stringify(
                credentials.map((c) => ({ id: c.id, name: c.name, type: c.type })),
                null,
                2
              )}`,
            },
          ],
        };
      } catch {
        // Fallback: scan workflows for credential references
        const wfResponse = await n8nClient.get("/api/v1/workflows");
        const workflows = wfResponse.data.data || [];
        const credentialSet = new Map();
        for (const wf of workflows) {
          for (const node of (wf.nodes || [])) {
            if (node.credentials) {
              for (const [type, cred] of Object.entries(node.credentials)) {
                credentialSet.set(cred.id, { id: cred.id, name: cred.name, type });
              }
            }
          }
        }
        const credentials = Array.from(credentialSet.values());
        return {
          content: [
            {
              type: "text",
              text: `Found ${credentials.length} credentials referenced in workflows:\n\n${JSON.stringify(credentials, null, 2)}`,
            },
          ],
        };
      }
    }
    if (name === "create_credential") {
      const { name: cred_name, type, data } = args;
      const response = await n8nClient.post("/api/v1/credentials", {
        name: cred_name,
        type,
        data,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created credential "${cred_name}" (ID: ${response.data.id})`,
          },
        ],
      };
    }
    // ============ VARIABLES ============
    if (name === "list_variables") {
      const response = await n8nClient.get("/api/v1/variables");
      const variables = response.data.data || [];
      return {
        content: [
          {
            type: "text",
            text: `Workflow variables:\n\n${JSON.stringify(variables, null, 2)}`,
          },
        ],
      };
    }
    if (name === "set_variable") {
      const { key, value } = args;
      const response = await n8nClient.post("/api/v1/variables", {
        key,
        value,
      });
      return {
        content: [{ type: "text", text: `Set variable ${key} = ${value}` }],
      };
    }
    if (name === "get_variable") {
      const { key } = args;
      const response = await n8nClient.get(`/api/v1/variables/${key}`);
      return {
        content: [
          {
            type: "text",
            text: `Variable ${key} = ${response.data.value}`,
          },
        ],
      };
    }
    // ============ SCHEDULES ============
    if (name === "list_schedules") {
      const response = await n8nClient.get("/api/v1/workflows");
      const workflows = response.data.data || [];
      const scheduled = workflows
        .filter((w) => w.nodes.some((n) => n.type.includes("schedule") || n.type.includes("cron")))
        .map((w) => {
          const schedNode = w.nodes.find((n) => n.type.includes("schedule") || n.type.includes("cron"));
          return {
            id: w.id,
            name: w.name,
            active: w.active,
            scheduleConfig: schedNode?.parameters || {},
          };
        });
      return {
        content: [
          {
            type: "text",
            text: `Scheduled workflows:\n\n${JSON.stringify(scheduled, null, 2)}`,
          },
        ],
      };
    }
    if (name === "set_schedule") {
      const { workflow_id, cron } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      // Find existing schedule trigger node
      const scheduleIdx = workflow.nodes.findIndex(
        (n) => n.type.includes("scheduleTrigger") || n.type.includes("cron")
      );
      const scheduleNode = {
        id: scheduleIdx >= 0 ? workflow.nodes[scheduleIdx].id : crypto.randomUUID(),
        name: "Schedule Trigger",
        type: "n8n-nodes-base.scheduleTrigger",
        position: scheduleIdx >= 0 ? workflow.nodes[scheduleIdx].position : [-200, 0],
        parameters: {
          rule: {
            interval: [
              {
                field: "cronExpression",
                expression: cron,
              },
            ],
          },
        },
        typeVersion: 1.2,
      };
      if (scheduleIdx >= 0) {
        workflow.nodes[scheduleIdx] = scheduleNode;
      } else {
        workflow.nodes.push(scheduleNode);
      }
      await saveWorkflow(workflow_id, workflow);
      return {
        content: [
          {
            type: "text",
            text: `Schedule set for workflow!\n\nCron: ${cron}\nNode: Schedule Trigger${
              scheduleIdx < 0
                ? "\n\nNote: New Schedule Trigger node added. You may want to connect it to your first processing node."
                : "\n\nExisting Schedule Trigger updated."
            }`,
          },
        ],
      };
    }
    // ============ WORKFLOW MANAGEMENT ============
    if (name === "create_workflow") {
      const { name: wf_name, description } = args;
      const payload = {
        name: wf_name,
        nodes: [],
        connections: {},
        settings: {},
      };
      const response = await n8nClient.post("/api/v1/workflows", payload);
      return {
        content: [
          {
            type: "text",
            text: `Created workflow:\n\nID: ${response.data.id}\nName: ${response.data.name}\n\nYou can now add nodes to it!`,
          },
        ],
      };
    }
    if (name === "delete_workflow") {
      const { workflow_id } = args;
      // First get the name for confirmation
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      const wfName = workflow.name;
      await n8nClient.delete(`/api/v1/workflows/${workflow_id}`);
      return {
        content: [
          {
            type: "text",
            text: `Deleted workflow "${wfName}" (ID: ${workflow_id})`,
          },
        ],
      };
    }
    if (name === "activate_workflow") {
      const { workflow_id, active } = args;
      // Use PUT to toggle active status (works on all n8n CE versions)
      try {
        const response = await n8nClient.post(`/api/v1/workflows/${workflow_id}/${active ? "activate" : "deactivate"}`);
        return {
          content: [
            {
              type: "text",
              text: `Workflow "${response.data.name}" is now ${active ? "ACTIVE" : "INACTIVE"}`,
            },
          ],
        };
      } catch (activateErr) {
        // Fallback: use PUT to set active field directly
        const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
        workflow.active = active;
        const updated = await saveWorkflow(workflow_id, workflow);
        return {
          content: [
            {
              type: "text",
              text: `Workflow "${updated.data.name || workflow.name}" is now ${active ? "ACTIVE" : "INACTIVE"} (via PUT)`,
            },
          ],
        };
      }
    }
    // ============ FULL WORKFLOW UPDATE ============
    if (name === "update_workflow") {
      const { workflow_id, workflow_json } = args;
      const body = JSON.parse(workflow_json);
      const response = await n8nClient.put(`/api/v1/workflows/${workflow_id}`, {
        name: body.name,
        nodes: body.nodes,
        connections: body.connections,
        settings: body.settings || {},
      });
      const wf = response.data;
      return {
        content: [
          {
            type: "text",
            text: `Workflow updated via PUT!\n\nID: ${wf.id}\nName: ${wf.name}\nNodes: ${wf.nodes?.length || 0}\nActive: ${wf.active}`,
          },
        ],
      };
    }
    // ============ DISCONNECT NODES ============
    if (name === "disconnect_nodes") {
      const { workflow_id, from_node, to_node } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      let removed = false;
      if (workflow.connections[from_node]) {
        for (const outputType of Object.keys(workflow.connections[from_node])) {
          workflow.connections[from_node][outputType] = workflow.connections[from_node][outputType].map(
            (arr) => {
              const filtered = arr.filter((c) => c.node !== to_node);
              if (filtered.length < arr.length) removed = true;
              return filtered;
            }
          );
        }
      }
      if (!removed) {
        return {
          content: [{ type: "text", text: `No connection found from "${from_node}" to "${to_node}".` }],
        };
      }
      await saveWorkflow(workflow_id, workflow);
      return {
        content: [{ type: "text", text: `Disconnected "${from_node}" ✕ "${to_node}"` }],
      };
    }
    // ============ SERVER SHELL & FILESYSTEM ============
    if (SHELL_ENABLED && name === "run_command") {
      const { command, working_dir, timeout_ms } = args;
      const cwd = working_dir || SHELL_WORKING_DIR;
      const timeout = timeout_ms || SHELL_TIMEOUT_MS;
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          shell: "/bin/bash",
        });
        return {
          content: [{
            type: "text",
            text: `Command: ${command}\nWorking dir: ${cwd}\nExit code: 0\n\n${stdout ? `--- STDOUT ---\n${stdout}` : "(no stdout)"}${stderr ? `\n\n--- STDERR ---\n${stderr}` : ""}`,
          }],
        };
      } catch (execErr) {
        return {
          content: [{
            type: "text",
            text: `Command: ${command}\nWorking dir: ${cwd}\nExit code: ${execErr.code || "unknown"}\n\n${execErr.stdout ? `--- STDOUT ---\n${execErr.stdout}` : "(no stdout)"}${execErr.stderr ? `\n\n--- STDERR ---\n${execErr.stderr}` : ""}${execErr.killed ? "\n\n(Process killed — timeout reached)" : ""}`,
          }],
          isError: true,
        };
      }
    }
    if (SHELL_ENABLED && name === "read_file") {
      const { file_path: filePath, encoding = "utf-8" } = args;
      const resolved = path.resolve(SHELL_WORKING_DIR, filePath);
      const content = await fs.readFile(resolved, encoding);
      const stats = await fs.stat(resolved);
      return {
        content: [{
          type: "text",
          text: `File: ${resolved} (${stats.size} bytes)\n\n${content}`,
        }],
      };
    }
    if (SHELL_ENABLED && name === "write_file") {
      const { file_path: filePath, content, append = false } = args;
      const resolved = path.resolve(SHELL_WORKING_DIR, filePath);
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      if (append) {
        await fs.appendFile(resolved, content, "utf-8");
      } else {
        await fs.writeFile(resolved, content, "utf-8");
      }
      const stats = await fs.stat(resolved);
      return {
        content: [{
          type: "text",
          text: `${append ? "Appended to" : "Wrote"} ${resolved} (${stats.size} bytes)`,
        }],
      };
    }
    if (SHELL_ENABLED && name === "list_directory") {
      const { dir_path } = args;
      const resolved = path.resolve(SHELL_WORKING_DIR, dir_path || SHELL_WORKING_DIR);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const details = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(resolved, entry.name);
          try {
            const stats = await fs.stat(fullPath);
            return {
              name: entry.name,
              type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
              size: stats.size,
              modified: stats.mtime.toISOString(),
            };
          } catch {
            return { name: entry.name, type: "unknown", size: 0, modified: null };
          }
        })
      );
      return {
        content: [{
          type: "text",
          text: `Directory: ${resolved}\nEntries: ${details.length}\n\n${JSON.stringify(details, null, 2)}`,
        }],
      };
    }
    if (SHELL_ENABLED && name === "create_directory") {
      const { dir_path } = args;
      const resolved = path.resolve(SHELL_WORKING_DIR, dir_path);
      await fs.mkdir(resolved, { recursive: true });
      return {
        content: [{ type: "text", text: `Created directory: ${resolved}` }],
      };
    }
    if (SHELL_ENABLED && name === "move_file") {
      const { source, destination } = args;
      const src = path.resolve(SHELL_WORKING_DIR, source);
      const dst = path.resolve(SHELL_WORKING_DIR, destination);
      await fs.rename(src, dst);
      return {
        content: [{ type: "text", text: `Moved: ${src} → ${dst}` }],
      };
    }
    if (SHELL_ENABLED && name === "copy_file") {
      const { source, destination, recursive = false } = args;
      const src = path.resolve(SHELL_WORKING_DIR, source);
      const dst = path.resolve(SHELL_WORKING_DIR, destination);
      if (recursive) {
        await fs.cp(src, dst, { recursive: true });
      } else {
        await fs.copyFile(src, dst);
      }
      return {
        content: [{ type: "text", text: `Copied: ${src} → ${dst}` }],
      };
    }
    if (SHELL_ENABLED && name === "delete_file") {
      const { target_path, recursive = false } = args;
      const resolved = path.resolve(SHELL_WORKING_DIR, target_path);
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        await fs.rm(resolved, { recursive, force: recursive });
      } else {
        await fs.unlink(resolved);
      }
      return {
        content: [{ type: "text", text: `Deleted: ${resolved}` }],
      };
    }
    if (SHELL_ENABLED && name === "file_info") {
      const { target_path } = args;
      const resolved = path.resolve(SHELL_WORKING_DIR, target_path);
      const stats = await fs.stat(resolved);
      return {
        content: [{
          type: "text",
          text: `Path: ${resolved}\n\n${JSON.stringify({
            type: stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : "file",
            size: stats.size,
            permissions: `0${(stats.mode & 0o777).toString(8)}`,
            uid: stats.uid,
            gid: stats.gid,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            accessed: stats.atime.toISOString(),
          }, null, 2)}`,
        }],
      };
    }
    // ============ EMAIL NOTIFICATIONS ============
    if (name === "send_result_email") {
      const { subject, body, to_email = USER_EMAIL } = args;
      // Create a temporary email workflow with webhook trigger for reliable execution
      const webhookPath = `_email_${Date.now()}`;
      const emailNodes = [
        {
          id: crypto.randomUUID(),
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          position: [0, 0],
          parameters: { path: webhookPath, httpMethod: "GET", responseMode: "onReceived" },
          typeVersion: 2,
          webhookId: crypto.randomUUID(),
        },
        {
          id: crypto.randomUUID(),
          name: "Send Email",
          type: "n8n-nodes-base.emailSend",
          position: [300, 0],
          parameters: {
            fromEmail: USER_EMAIL,
            toEmail: to_email,
            subject: subject,
            html: body,
          },
          typeVersion: 1,
        },
      ];
      // Attach SMTP credentials if configured
      if (SMTP_CREDENTIAL_ID) {
        emailNodes[1].credentials = {
          smtp: { id: SMTP_CREDENTIAL_ID, name: "SMTP account" },
        };
      }
      const emailWorkflow = await n8nClient.post("/api/v1/workflows", {
        name: `_auto_email_${Date.now()}`,
        nodes: emailNodes,
        connections: {
          Webhook: {
            main: [[{ node: "Send Email", type: "main", index: 0 }]],
          },
        },
        settings: {},
      });
      const wfId = emailWorkflow.data.id;
      let executionResult = "created";

      // Activate and trigger via webhook
      try {
        // Activate
        try {
          await n8nClient.post(`/api/v1/workflows/${wfId}/activate`);
        } catch {
          const wf = (await n8nClient.get(`/api/v1/workflows/${wfId}`)).data;
          wf.active = true;
          await n8nClient.put(`/api/v1/workflows/${wfId}`, {
            name: wf.name, nodes: wf.nodes, connections: wf.connections,
            settings: wf.settings || {}, active: true,
          });
        }

        // Wait for webhook registration
        await new Promise(r => setTimeout(r, 1500));

        // Trigger
        const webhookUrl = `${N8N_BASE_URL}/webhook/${webhookPath}`;
        await axios.get(webhookUrl);
        executionResult = "sent successfully";
      } catch (execErr) {
        executionResult = `created but execution failed: ${execErr.response?.data?.message || execErr.message}`;
      }

      // Cleanup
      try {
        await n8nClient.post(`/api/v1/workflows/${wfId}/deactivate`).catch(() => {});
        await n8nClient.delete(`/api/v1/workflows/${wfId}`);
        executionResult += " (temp workflow cleaned up)";
      } catch {
        executionResult += ` (temp workflow ${wfId} remains - delete manually)`;
      }

      return {
        content: [
          {
            type: "text",
            text: `Email to ${to_email}:\n\nSubject: ${subject}\nStatus: ${executionResult}`,
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.response?.data?.message || error.message}`,
        },
      ],
      isError: true,
    };
  }
});
} // end registerHandlers

const VERSION = "4.0.0";

// Track active SSE transports by session ID (legacy)
const sseTransports = new Map();

// Track Streamable HTTP transports by session ID
const streamableTransports = new Map();

// Helper: create a new Server+Transport pair for a Streamable HTTP session
function createStreamableSession() {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      streamableTransports.set(sessionId, transport);
      console.error(`[session] New Streamable HTTP session: ${sessionId}`);
    },
  });

  const serverInstance = new Server(
    { name: "n8n-mcp-server", version: VERSION },
    { capabilities: { tools: {} } }
  );
  registerHandlers(serverInstance);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      streamableTransports.delete(sid);
      console.error(`[session] Closed: ${sid}`);
    }
  };

  return { transport, serverInstance };
}

const httpServer = createServer(async (req, res) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization, Last-Event-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    let n8nStatus = "unknown";
    try {
      await n8nClient.get("/api/v1/workflows?limit=1");
      n8nStatus = "connected";
    } catch (e) {
      n8nStatus = `unreachable: ${e.message}`;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      server: "n8n-mcp-server",
      version: VERSION,
      n8n: n8nStatus,
      sessions: streamableTransports.size,
    }));
    return;
  }

  // ============ Streamable HTTP transport at /mcp ============
  if (req.url === "/mcp") {

    if (req.method === "POST") {
      const sessionId = req.headers["mcp-session-id"];

      // Case 1: Existing session — pass request directly (body not consumed)
      if (sessionId) {
        const transport = streamableTransports.get(sessionId);
        if (transport) {
          await transport.handleRequest(req, res);
          return;
        }
        // Session ID provided but not found — stale/expired session.
        // Return 404 to tell the client to re-initialize.
        console.error(`[session] Stale session ${sessionId} — returning 404`);
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found. Please re-initialize." },
          id: null,
        }));
        return;
      }

      // Case 2: No session ID — must be an initialize request.
      // Create a new transport+server pair. The SDK validates that the
      // request is actually an initialize; non-init requests without a
      // session ID are rejected with 400 by the SDK itself.
      try {
        const { transport, serverInstance } = createStreamableSession();
        await serverInstance.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error(`[session] Failed to create session: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: `Internal error: ${err.message}` },
            id: null,
          }));
        }
      }
      return;
    }

    // GET /mcp — SSE stream for server-initiated messages
    if (req.method === "GET") {
      const sessionId = req.headers["mcp-session-id"];
      const transport = sessionId ? streamableTransports.get(sessionId) : null;
      if (transport) {
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found. Please re-initialize." },
          id: null,
        }));
      }
      return;
    }

    // DELETE /mcp — acknowledge but keep session alive to avoid premature teardown
    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"];
      console.error(`[session] DELETE requested for ${sessionId} — keeping alive`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
  }

  // ============ Legacy SSE transport ============
  if (req.method === "GET" && req.url === "/sse") {
    console.error("[sse] New SSE connection");
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, transport);

    transport.onclose = () => {
      console.error(`[sse] Session ${transport.sessionId} closed`);
      sseTransports.delete(transport.sessionId);
    };

    const serverInstance = new Server(
      { name: "n8n-mcp-server", version: VERSION },
      { capabilities: { tools: {} } }
    );
    registerHandlers(serverInstance);
    await serverInstance.connect(transport);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/messages")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId");
    const transport = sseTransports.get(sessionId);

    if (!transport) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired session" }));
      return;
    }

    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.error(`n8n MCP Server v${VERSION} running on port ${PORT}`);
  console.error(`  n8n target:     ${N8N_BASE_URL}`);
  console.error(`  Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.error(`  Legacy SSE:      http://localhost:${PORT}/sse`);
  console.error(`  Health check:    http://localhost:${PORT}/health`);
});
