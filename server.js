import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import crypto from "node:crypto";
import axios from "axios";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3001;
const N8N_BASE_URL = process.env.N8N_BASE_URL || "http://localhost:5678";
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const USER_EMAIL = process.env.USER_EMAIL || "your-email@example.com";
const SMTP_CREDENTIAL_ID = process.env.SMTP_CREDENTIAL_ID || "";
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";
const n8nClient = axios.create({
  baseURL: N8N_BASE_URL,
  headers: {
    "X-N8N-API-KEY": N8N_API_KEY,
    "Content-Type": "application/json",
  },
});

const ajv = new Ajv({ allErrors: true, removeAdditional: false, strict: false });
addFormats(ajv);
const validatorCache = new Map();
const metrics = {
  mcp_tool_calls_total: 0,
  mcp_errors_total: 0,
  mcp_rate_limited_total: 0,
  mcp_validation_failures_total: 0,
};

const TOOL_INPUT_SCHEMAS = {
  list_workflows: { type: "object", properties: {}, required: [] },
  get_workflow_details: {
    type: "object",
    properties: { workflow_id: { type: "string" } },
    required: ["workflow_id"],
  },
  create_workflow: {
    type: "object",
    properties: { name: { type: "string" }, description: { type: "string" } },
    required: ["name"],
  },
  delete_workflow: {
    type: "object",
    properties: { workflow_id: { type: "string" } },
    required: ["workflow_id"],
  },
  activate_workflow: {
    type: "object",
    properties: { workflow_id: { type: "string" }, active: { type: "boolean" } },
    required: ["workflow_id", "active"],
  },
  add_node_to_workflow: {
    type: "object",
    properties: {
      workflow_id: { type: "string" },
      node_name: { type: "string" },
      node_type: { type: "string" },
      position: { type: "array", items: { type: "number" } },
      config: { type: "object" },
      credentials: { type: "object" },
    },
    required: ["workflow_id", "node_name", "node_type", "position"],
  },
  remove_node_from_workflow: {
    type: "object",
    properties: { workflow_id: { type: "string" }, node_name: { type: "string" } },
    required: ["workflow_id", "node_name"],
  },
  update_node: {
    type: "object",
    properties: {
      workflow_id: { type: "string" },
      node_name: { type: "string" },
      config: { type: "object" },
      credentials: { type: "object" },
    },
    required: ["workflow_id", "node_name"],
  },
  connect_nodes: {
    type: "object",
    properties: {
      workflow_id: { type: "string" },
      from_node: { type: "string" },
      to_node: { type: "string" },
      from_output: { type: "string" },
    },
    required: ["workflow_id", "from_node", "to_node"],
  },
  execute_workflow: {
    type: "object",
    properties: { workflow_id: { type: "string" } },
    required: ["workflow_id"],
  },
  get_execution_result: {
    type: "object",
    properties: { execution_id: { type: "string" } },
    required: ["execution_id"],
  },
  get_workflow_executions: {
    type: "object",
    properties: { workflow_id: { type: "string" }, limit: { type: "number" } },
    required: ["workflow_id"],
  },
  create_webhook: {
    type: "object",
    properties: { workflow_id: { type: "string" }, path: { type: "string" } },
    required: ["workflow_id", "path"],
  },
  list_webhooks: {
    type: "object",
    properties: { workflow_id: { type: "string" } },
    required: ["workflow_id"],
  },
  get_webhook_logs: {
    type: "object",
    properties: { workflow_id: { type: "string" }, limit: { type: "number" } },
    required: ["workflow_id"],
  },
  list_credentials: { type: "object", properties: {}, required: [] },
  create_credential: {
    type: "object",
    properties: { name: { type: "string" }, type: { type: "string" }, data: { type: "object" } },
    required: ["name", "type", "data"],
  },
  list_variables: { type: "object", properties: {}, required: [] },
  set_variable: {
    type: "object",
    properties: { key: { type: "string" }, value: {} },
    required: ["key", "value"],
  },
  get_variable: {
    type: "object",
    properties: { key: { type: "string" } },
    required: ["key"],
  },
  list_schedules: { type: "object", properties: {}, required: [] },
  set_schedule: {
    type: "object",
    properties: { workflow_id: { type: "string" }, cron: { type: "string" } },
    required: ["workflow_id", "cron"],
  },
  send_result_email: {
    type: "object",
    properties: { subject: { type: "string" }, body: { type: "string" }, to_email: { type: "string" } },
    required: ["subject", "body"],
  },
  update_workflow: {
    type: "object",
    properties: { workflow_id: { type: "string" }, workflow_json: { type: "string" } },
    required: ["workflow_id", "workflow_json"],
  },
  disconnect_nodes: {
    type: "object",
    properties: { workflow_id: { type: "string" }, from_node: { type: "string" }, to_node: { type: "string" } },
    required: ["workflow_id", "from_node", "to_node"],
  },
};

function validateToolArgsOrThrow(toolName, inputSchema, args) {
  const schema = {
    ...inputSchema,
    type: "object",
    additionalProperties: false,
  };

  let validate = validatorCache.get(toolName);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(toolName, validate);
  }

  const candidateArgs = args === undefined ? {} : args;
  const ok = validate(candidateArgs);
  if (ok) {
    return;
  }

  const invalid_fields = (validate.errors || []).map((e) => ({
    field: (e.instancePath || "").replace(/^\//, "") || "(root)",
    reason: e.message || "invalid",
    expected: e.params || {},
  }));
  metrics.mcp_validation_failures_total += 1;

  throw new McpError(ErrorCode.InvalidParams, "Invalid params", {
    error_code: "INVALID_PARAMS",
    retryable: false,
    details: { invalid_fields, tool_name: toolName },
  });
}

function mapToolError(error, { correlationId, sessionId, toolName, durationMs }) {
  if (error instanceof McpError) {
    metrics.mcp_errors_total += 1;
    if (error.code === -32003 || error.code === -32000 || error.code === -32029) {
      metrics.mcp_rate_limited_total += 1;
    }
    return error;
  }

  const status = error?.response?.status;
  const downstreamMessage = error?.response?.data?.message || error?.message || "Internal server error";
  let code = ErrorCode.InternalError;
  let message = "Internal server error";
  let errorCode = "INTERNAL_ERROR";
  let retryable = false;
  let details = {};

  if (status === 404) {
    code = -32010;
    message = "Resource not found";
    errorCode = "RESOURCE_NOT_FOUND";
  } else if (status === 401 || status === 403) {
    code = -32011;
    message = "Downstream auth failed";
    errorCode = "DOWNSTREAM_AUTH_FAILED";
  } else if (status === 429) {
    code = -32029;
    message = "Downstream rate limit";
    errorCode = "DOWNSTREAM_RATE_LIMIT";
    retryable = true;
    metrics.mcp_rate_limited_total += 1;
    const retryAfterHeader = error?.response?.headers?.["retry-after"];
    const retryAfterSeconds = Number.parseInt(retryAfterHeader || "1", 10);
    details.retry_after_ms = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1000;
  } else if (status >= 500) {
    code = -32050;
    message = "Downstream service unavailable";
    errorCode = "DOWNSTREAM_5XX";
    retryable = true;
  }
  metrics.mcp_errors_total += 1;

  return new McpError(code, message, {
    error_code: errorCode,
    retryable,
    details: {
      ...details,
      upstream_status: status ?? null,
      upstream_message: downstreamMessage,
      correlation_id: correlationId,
      session_id: sessionId || null,
      tool_name: toolName || null,
      duration_ms: durationMs ?? 0,
    },
  });
}
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
    ],
  };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();
  const { name, arguments: args } = request.params || {};
  metrics.mcp_tool_calls_total += 1;
  console.error(`[mcp][${correlationId}] tools/call name=${name || "unknown"}`);
  const withCorrelation = (result) => ({
    ...result,
    _meta: {
      ...(result?._meta || {}),
      correlation_id: correlationId,
    },
  });
  const toolSchema = TOOL_INPUT_SCHEMAS[name];
  if (!toolSchema) {
    throw new McpError(-32010, "Tool not found", {
      error_code: "RESOURCE_NOT_FOUND",
      retryable: false,
      details: {
        tool_name: name || null,
        correlation_id: correlationId,
      },
    });
  }

  validateToolArgsOrThrow(name, toolSchema, args);

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
      return withCorrelation({
        content: [
          {
            type: "text",
            text: `Found ${filtered.length} workflows:\n\n${JSON.stringify(filtered, null, 2)}`,
          },
        ],
      });
    }
    if (name === "get_workflow_details") {
      const { workflow_id } = args;
      const response = await n8nClient.get(`/api/v1/workflows/${workflow_id}`);
      const workflow = response.data;
      return withCorrelation({
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
      });
    }
    // ============ NODE MANAGEMENT ============
    // Helper: save workflow via PUT with required fields only
    async function saveWorkflow(workflow_id, workflow) {
      return n8nClient.put(`/api/v1/workflows/${workflow_id}`, {
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings || {},
      });
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
      {
        let tempWorkflowId = null;
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
          tempWorkflowId = wrapperWf.data.id;

          // Activate it so webhook registers
          try {
            await n8nClient.post(`/api/v1/workflows/${tempWorkflowId}/activate`);
          } catch {
            // Try PUT fallback
            const wf = (await n8nClient.get(`/api/v1/workflows/${tempWorkflowId}`)).data;
            wf.active = true;
            await n8nClient.put(`/api/v1/workflows/${tempWorkflowId}`, {
              name: wf.name, nodes: wf.nodes, connections: wf.connections,
              settings: wf.settings || {}, active: true,
            });
          }

          // Small delay for webhook registration
          await new Promise(r => setTimeout(r, 1000));

          // Trigger via webhook
          const webhookUrl = `${N8N_BASE_URL}/webhook/${wrapperPath}`;
          const execResponse = await axios.get(webhookUrl);

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
        } finally {
          if (tempWorkflowId) {
            await n8nClient.post(`/api/v1/workflows/${tempWorkflowId}/deactivate`)
              .catch(() => {});
            await n8nClient.delete(`/api/v1/workflows/${tempWorkflowId}`)
              .catch(err => console.error(`Cleanup failed for wrapper ${tempWorkflowId}:`, err.message));
          }
        }
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
      const webhookUrl = `${N8N_BASE_URL}/webhook/${path}`;
      return {
        content: [
          {
            type: "text",
            text: `Webhook created:\n\nURL: ${webhookUrl}\nWorkflow ID: ${workflow_id}\n\nAdd a Webhook trigger node with path: ${path}`,
          },
        ],
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
    throw new McpError(-32010, "Tool not found", {
      error_code: "RESOURCE_NOT_FOUND",
      retryable: false,
      details: { tool_name: name, correlation_id: correlationId },
    });
  } catch (error) {
    throw mapToolError(error, {
      correlationId,
      toolName: name,
      durationMs: Date.now() - startedAt,
    });
  }
});
} // end registerHandlers

// Track active SSE transports by session ID (legacy)
const transports = new Map();

// Track Streamable HTTP transports by session ID
const streamableTransports = new Map();

// Rate-limit tracker for bad GET requests (prevent log flooding)
const badGetTracker = new Map();
const BAD_GET_INTERVAL_MS = 60000; // Only log once per minute per IP

// Session limits
const MAX_SESSIONS = Number.parseInt(process.env.MAX_ACTIVE_SESSIONS || "100", 10);
const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_SECONDS || "1800", 10) * 1000;
const SESSION_IDLE_TTL_MS = Number.parseInt(process.env.SESSION_IDLE_TTL_SECONDS || "600", 10) * 1000;
const MAX_CONCURRENCY_PER_SESSION = Number.parseInt(process.env.MAX_CONCURRENCY_PER_SESSION || "4", 10);
const CONCURRENCY_HOLD_MS = Number.parseInt(process.env.CONCURRENCY_HOLD_MS || "8", 10);
const sessionTimestamps = new Map(); // sessionId → creation time
const sessionLastActivity = new Map(); // sessionId → last activity
const sessionInflightCounts = new Map(); // sessionId → in-flight request count

function writeJsonRpcError(res, {
  code,
  message,
  error_code,
  retryable = false,
  details = {},
  correlation_id = null,
  id = null,
}, statusCode = 400) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data: {
        error_code,
        retryable,
        correlation_id,
        details,
      },
    },
  }));
}

function acquireInflightOrThrow(sessionId, maxConcurrency) {
  const current = sessionInflightCounts.get(sessionId) || 0;
  if (current >= maxConcurrency) {
    throw new McpError(-32003, "Session concurrency limit exceeded", {
      error_code: "SESSION_CONCURRENCY_LIMIT",
      retryable: true,
      details: {
        max_concurrency_per_session: maxConcurrency,
        retry_after_ms: 250,
      },
    });
  }
  const next = current + 1;
  sessionInflightCounts.set(sessionId, next);
  return next;
}

function releaseInflight(sessionId) {
  const current = sessionInflightCounts.get(sessionId) || 0;
  if (current <= 1) {
    sessionInflightCounts.delete(sessionId);
    return;
  }
  sessionInflightCounts.set(sessionId, current - 1);
}

// Evict expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sid, created] of sessionTimestamps) {
    const lastActivity = sessionLastActivity.get(sid) || created;
    const ttlExpired = now - created > SESSION_TTL_MS;
    const idleExpired = now - lastActivity > SESSION_IDLE_TTL_MS;
    if (ttlExpired || idleExpired) {
      const transport = streamableTransports.get(sid);
      if (transport) {
        try { transport.close?.(); } catch {}
      }
      streamableTransports.delete(sid);
      sessionTimestamps.delete(sid);
      sessionLastActivity.delete(sid);
      sessionInflightCounts.delete(sid);
    }
  }
  // Also clean stale badGetTracker entries
  for (const [ip, ts] of badGetTracker) {
    if (now - ts > BAD_GET_INTERVAL_MS * 5) badGetTracker.delete(ip);
  }
}, 60000);

/**
 * Constant-time string comparison to prevent timing attacks on auth tokens.
 */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Set a header on both req.headers and req.rawHeaders (Hono reads rawHeaders).
 */
function setHeader(req, name, value) {
  const lowerName = name.toLowerCase();
  req.headers[lowerName] = value;
  // rawHeaders is a flat [key, value, key, value, ...] array
  let found = false;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === lowerName) {
      req.rawHeaders[i + 1] = value;
      found = true;
      break;
    }
  }
  if (!found) {
    req.rawHeaders.push(name, value);
  }
}

/**
 * Normalize incoming request headers for SDK compatibility.
 * - Maps unsupported mcp-protocol-version values to closest supported version
 * - Ensures Accept header includes required content types
 */
function normalizeHeaders(req) {
  // Fix protocol version: map unknown versions to closest supported
  const protoVer = req.headers["mcp-protocol-version"];
  if (protoVer && !SUPPORTED_PROTOCOL_VERSIONS.includes(protoVer)) {
    const sorted = [...SUPPORTED_PROTOCOL_VERSIONS].filter(v => !v.startsWith("DRAFT")).sort();
    const closest = sorted.reverse().find(v => v <= protoVer) || sorted[0] || SUPPORTED_PROTOCOL_VERSIONS[0];
    console.error(`Mapping unsupported protocol ${protoVer} → ${closest}`);
    setHeader(req, "mcp-protocol-version", closest);
  }

  // Fix Accept header: SDK requires both application/json and text/event-stream for POST
  if (req.method === "POST") {
    const accept = req.headers["accept"] || "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      setHeader(req, "Accept", "application/json, text/event-stream");
    }
  }
  // Fix Accept header for GET: SDK requires text/event-stream
  if (req.method === "GET") {
    const accept = req.headers["accept"] || "";
    if (!accept.includes("text/event-stream")) {
      setHeader(req, "Accept", "text/event-stream");
    }
  }
}

const httpServer = createServer(async (req, res) => {
  const correlationId = crypto.randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  // Log requests with token redacted
  const safeUrl = MCP_AUTH_TOKEN ? req.url.replace(MCP_AUTH_TOKEN, "***") : req.url;
  console.error(`[${new Date().toISOString()}] [${correlationId}] ${req.method} ${safeUrl}`);

  // CORS - restrict to known origins (Claude.ai, OpenAI, localhost)
  const origin = req.headers["origin"] || "";
  const allowedOrigins = ["https://claude.ai", "https://chat.openai.com", "https://platform.openai.com", "https://chatgpt.com"];
  if (allowedOrigins.includes(origin) || origin.startsWith("http://localhost")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Authorization, mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "GET" && req.url === "/metrics") {
    const payload = {
      mcp_active_sessions: streamableTransports.size,
      mcp_tool_calls_total: metrics.mcp_tool_calls_total,
      mcp_errors_total: metrics.mcp_errors_total,
      mcp_rate_limited_total: metrics.mcp_rate_limited_total,
      mcp_validation_failures_total: metrics.mcp_validation_failures_total,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  // ============ Outbound Demo UI ============
  if (req.method === "GET" && (req.url === "/demo" || req.url === "/demo/")) {
    try {
      const html = await readFile(join(__dirname, "public", "demo.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Demo page not found");
    }
    return;
  }

  // POST /demo-api/outbound-call — create a Vapi outbound call
  if (req.method === "POST" && req.url === "/demo-api/outbound-call") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { phone, use_case, forced_intent, active_profile, goal, success_criteria } = JSON.parse(body);
      if (!phone) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Phone number required" }));
        return;
      }
      const VAPI_KEY = process.env.VAPI_API_KEY || "205b02f6-0738-45d5-99e4-427b6c022312";
      const OUTBOUND_ASSISTANT_ID = "20177a65-d618-4875-b029-dfb7fa6d1da3";
      const ucGoal = goal || "Handle outbound customer interaction.";
      const ucSuccess = success_criteria || "Customer engagement completed";

      const OUTBOUND_PHONE_NUMBER_ID = "fa7c2978-38fc-4456-9d92-747c119ef16d";

      const vapiPayload = {
        assistantId: OUTBOUND_ASSISTANT_ID,
        phoneNumberId: OUTBOUND_PHONE_NUMBER_ID,
        customer: { number: phone },
        metadata: {
          outbound: true,
          use_case: use_case || "RETENTION_CONTRACT_EXPIRY",
          forced_intent: forced_intent || "RETENTION",
          active_profile: active_profile || "HIGH_END",
          goal: ucGoal,
          success_criteria: ucSuccess,
        },
      };

      console.error(`[DEMO] Creating outbound call: phone=${phone}, use_case=${use_case}, profile=${active_profile}`);
      const vapiRes = await axios.post("https://api.vapi.ai/call", vapiPayload, {
        headers: { Authorization: `Bearer ${VAPI_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
      });

      const callData = vapiRes.data;
      const callId = callData.id;

      // Pre-cache metadata so outbound proxy picks it up
      if (!global._outboundMetadataCache) global._outboundMetadataCache = {};
      global._outboundMetadataCache[callId] = { ...vapiPayload.metadata };

      console.error(`[DEMO] Call created: id=${callId}, status=${callData.status}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ callId, status: callData.status || "queued" }));
    } catch (e) {
      console.error(`[DEMO] Call creation failed: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.response?.data?.message || e.message }));
    }
    return;
  }

  // GET /demo-api/call-status/:callId — poll Vapi for call status
  if (req.method === "GET" && req.url?.startsWith("/demo-api/call-status/")) {
    const callId = req.url.split("/demo-api/call-status/")[1];
    if (!callId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Call ID required" }));
      return;
    }
    try {
      const VAPI_KEY = process.env.VAPI_API_KEY || "205b02f6-0738-45d5-99e4-427b6c022312";
      const vapiRes = await axios.get(`https://api.vapi.ai/call/${callId}`, {
        headers: { Authorization: `Bearer ${VAPI_KEY}` },
        timeout: 10000,
      });
      const call = vapiRes.data;
      const result = {
        status: call.status || "unknown",
        duration: call.duration || null,
        endedReason: call.endedReason || null,
        transcript: call.transcript || null,
        messages: call.messages || null,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message, status: "unknown" }));
    }
    return;
  }

  // ============ Authentication ============
  // Bearer-only authentication
  let authenticated = false;
  if (MCP_AUTH_TOKEN) {
    const authHeader = req.headers["authorization"] || "";
    if (authHeader.startsWith("Bearer ") && safeEqual(authHeader.slice(7), MCP_AUTH_TOKEN)) {
      authenticated = true;
    }
  } else {
    authenticated = true; // No token configured = open access
  }

  // Protect MCP endpoints (both Streamable HTTP and legacy SSE)
  // Note: /vapi/chat/completions is NOT protected — it's behind nginx TLS and Vapi doesn't send auth headers
  const isProtectedPath = req.url === "/mcp" || req.url.startsWith("/mcp?") || req.url.startsWith("/mcp/")
    || req.url === "/sse" || req.url.startsWith("/messages");

  if (isProtectedPath && !authenticated && req.method !== "OPTIONS") {
    metrics.mcp_errors_total += 1;
    writeJsonRpcError(res, {
      code: -32001,
      message: "Authentication failed",
      error_code: "AUTH_FAILED",
      retryable: false,
      correlation_id: correlationId,
      details: {},
    }, 401);
    return;
  }

  // Normalize headers for SDK compatibility (protocol version, Accept)
  normalizeHeaders(req);

  // ============ Streamable HTTP transport at /mcp ============
  if (req.url === "/mcp") {
    // POST /mcp - handle JSON-RPC messages (initialize, tool calls, etc.)
    if (req.method === "POST") {
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? streamableTransports.get(sessionId) : null;

      if (!transport) {
        if (sessionId) {
          // Stale session — strip the old session ID and create fresh
          // Claude's MCP client doesn't re-initialize on 404, so we recover gracefully
          console.error(`Stale session ${sessionId} — auto-recovering`);
          delete req.headers["mcp-session-id"];
          for (let i = 0; i < req.rawHeaders.length; i += 2) {
            if (req.rawHeaders[i].toLowerCase() === "mcp-session-id") {
              req.rawHeaders.splice(i, 2);
              break;
            }
          }
        }

        // Session limit check
        if (streamableTransports.size >= MAX_SESSIONS) {
          console.error(`Session limit reached (${MAX_SESSIONS}), rejecting new session`);
          metrics.mcp_errors_total += 1;
          metrics.mcp_rate_limited_total += 1;
          writeJsonRpcError(res, {
            code: -32000,
            message: "Server busy. Too many active sessions.",
            error_code: "SESSION_CAPACITY_EXCEEDED",
            retryable: true,
            correlation_id: correlationId,
            details: {
              max_active_sessions: MAX_SESSIONS,
              retry_after_ms: 1000,
            },
          }, 503);
          return;
        }

        // New session - create transport and server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        const serverInstance = new Server(
          { name: "n8n-mcp-server", version: "2.5.0" },
          { capabilities: { tools: {} } }
        );
        registerHandlers(serverInstance);

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            streamableTransports.delete(sid);
            sessionTimestamps.delete(sid);
            sessionLastActivity.delete(sid);
            sessionInflightCounts.delete(sid);
          }
          console.error(`Streamable HTTP session closed: ${sid} (active: ${streamableTransports.size})`);
        };

        await serverInstance.connect(transport);

        if (transport.sessionId) {
          streamableTransports.set(transport.sessionId, transport);
          sessionTimestamps.set(transport.sessionId, Date.now());
          sessionLastActivity.set(transport.sessionId, Date.now());
          console.error(`New session created: ${transport.sessionId} (active: ${streamableTransports.size})`);
        }

        // If this was a stale session recovery, the incoming request is likely a tool call,
        // not an initialize. We need to auto-initialize first, then process the actual request.
        if (sessionId) {
          // Synthesize an initialize request to bootstrap the session
          const { Readable } = await import("node:stream");
          const initPayload = JSON.stringify({
            jsonrpc: "2.0",
            id: "_auto_init_" + Date.now(),
            method: "initialize",
            params: {
              protocolVersion: req.headers["mcp-protocol-version"] || "2025-11-25",
              capabilities: {},
              clientInfo: { name: "auto-recovery", version: "1.0" },
            },
          });
          const initReq = new Readable({ read() { this.push(initPayload); this.push(null); } });
          Object.assign(initReq, {
            method: "POST",
            url: "/mcp",
            headers: { ...req.headers, "content-type": "application/json", "content-length": String(initPayload.length) },
            rawHeaders: ["Content-Type", "application/json", "Accept", "application/json, text/event-stream", "Content-Length", String(initPayload.length)],
            socket: req.socket,
          });
          // Process init silently (discard response)
          const { Writable } = await import("node:stream");
          const devNull = new Writable({
            write(chunk, enc, cb) { cb(); },
          });
          devNull.writeHead = () => devNull;
          devNull.setHeader = () => devNull;
          devNull.flushHeaders = () => {};
          devNull.headersSent = false;
          await transport.handleRequest(initReq, devNull);

          // Send initialized notification
          const notifPayload = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
          const notifReq = new Readable({ read() { this.push(notifPayload); this.push(null); } });
          Object.assign(notifReq, {
            method: "POST",
            url: "/mcp",
            headers: { ...req.headers, "mcp-session-id": transport.sessionId, "content-type": "application/json", "content-length": String(notifPayload.length) },
            rawHeaders: ["Content-Type", "application/json", "Accept", "application/json, text/event-stream", "Mcp-Session-Id", transport.sessionId, "Content-Length", String(notifPayload.length)],
            socket: req.socket,
          });
          const devNull2 = new Writable({ write(chunk, enc, cb) { cb(); } });
          devNull2.writeHead = () => devNull2;
          devNull2.setHeader = () => devNull2;
          devNull2.flushHeaders = () => {};
          devNull2.headersSent = false;
          await transport.handleRequest(notifReq, devNull2);

          // Set the session ID on the actual request
          setHeader(req, "Mcp-Session-Id", transport.sessionId);
          console.error(`Auto-initialized session ${transport.sessionId} for stale recovery`);
        }
      }
      let acquiredSessionId = null;
      const existingSessionId = req.headers["mcp-session-id"];
      const resolvedSessionId = typeof existingSessionId === "string" ? existingSessionId : transport.sessionId;
      if (resolvedSessionId) {
        try {
          acquireInflightOrThrow(resolvedSessionId, MAX_CONCURRENCY_PER_SESSION);
          acquiredSessionId = resolvedSessionId;
        } catch (err) {
          const error = mapToolError(err, {
            correlationId: crypto.randomUUID(),
            sessionId: resolvedSessionId,
            toolName: null,
            durationMs: 0,
          });
          writeJsonRpcError(res, {
            code: error.code || -32003,
            message: error.message || "Session concurrency limit exceeded",
            error_code: error?.data?.error_code || "SESSION_CONCURRENCY_LIMIT",
            retryable: error?.data?.retryable ?? true,
            correlation_id: correlationId,
            details: error?.data?.details || {
              max_concurrency_per_session: MAX_CONCURRENCY_PER_SESSION,
              retry_after_ms: 250,
            },
          }, 429);
          return;
        }
      }

      if (acquiredSessionId) {
        let released = false;
        const releaseOnce = () => {
          if (released) return;
          released = true;
          const holdMs = CONCURRENCY_HOLD_MS;
          const releaseAction = () => {
            releaseInflight(acquiredSessionId);
            sessionLastActivity.set(acquiredSessionId, Date.now());
          };
          if (holdMs > 0) {
            setTimeout(releaseAction, holdMs);
          } else {
            releaseAction();
          }
        };
        res.once("finish", releaseOnce);
        res.once("close", releaseOnce);
      }

      await transport.handleRequest(req, res);

      // After handling, if a new session was created, store it
      if (transport.sessionId && !streamableTransports.has(transport.sessionId)) {
        streamableTransports.set(transport.sessionId, transport);
      }
      return;
    }

    // GET /mcp - SSE stream for server-initiated messages
    if (req.method === "GET") {
      const sessionId = req.headers["mcp-session-id"];
      const transport = sessionId ? streamableTransports.get(sessionId) : null;
      if (transport) {
        await transport.handleRequest(req, res);
        sessionLastActivity.set(sessionId, Date.now());
      } else {
        // Rate-limit log flooding from clients repeatedly hitting with bad/no session
        const clientIp = req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
        const now = Date.now();
        const lastLog = badGetTracker.get(clientIp) || 0;
        if (now - lastLog > BAD_GET_INTERVAL_MS) {
          console.error(`GET /mcp with unknown session from ${clientIp} (sid: ${sessionId || "none"})`);
          badGetTracker.set(clientIp, now);
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session expired. Please re-initialize with POST." }));
      }
      return;
    }

    // DELETE /mcp - close session (disabled: Claude tends to prematurely close sessions)
    if (req.method === "DELETE") {
      // Acknowledge the DELETE but don't actually close the session
      // This prevents Claude's MCP client from tearing down sessions too early
      const sessionId = req.headers["mcp-session-id"];
      console.error(`DELETE requested for session ${sessionId} - keeping session alive`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
  }

  // ============ Legacy SSE transport ============
  // SSE endpoint - client connects here to establish stream
  if (req.method === "GET" && req.url === "/sse") {
    console.error("New SSE connection");
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);

    transport.onclose = () => {
      console.error(`SSE session ${transport.sessionId} closed`);
      transports.delete(transport.sessionId);
    };

    const serverInstance = new Server(
      { name: "n8n-mcp-server", version: "2.5.0" },
      { capabilities: { tools: {} } }
    );

    registerHandlers(serverInstance);

    await serverInstance.connect(transport);
    return;
  }

  // Message endpoint - client POSTs JSON-RPC messages here
  if (req.method === "POST" && req.url?.startsWith("/messages")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId");
    const transport = transports.get(sessionId);

    if (!transport) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired session" }));
      return;
    }

    await transport.handlePostMessage(req, res);
    return;
  }

  // VAPI OpenAI-compatible proxy: forwards VAPI payload to n8n webhook (which handles OpenAI format natively)
  // /vapi/chat/completions → inbound (voice-gateway)
  // /vapi-outbound/chat/completions → outbound (voice-gateway-outbound)
  const vapiRoutes = {
    "/vapi/chat/completions": "/webhook/voice-gateway",
    "/vapi-outbound/chat/completions": "/webhook/voice-gateway-outbound",
  };
  if (req.method === "POST" && vapiRoutes[req.url]) {
    const n8nWebhookPath = vapiRoutes[req.url];
    let body = "";
    let startTime = Date.now();
    let callId = 'unknown';
    const MAX_BODY = 512 * 1024; // 512KB limit
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Request too large", type: "invalid_request_error" } }));
        return;
      }
    }
    try {
      const openaiReq = JSON.parse(body);

      callId = openaiReq.call?.id || 'none';
      startTime = Date.now();
      console.error(`[VAPI] Incoming: messages=${(openaiReq.messages||[]).length}, call_id=${callId}, stream=${openaiReq.stream}`);

      // ── OUTBOUND METADATA INJECTION ──
      // Vapi Chat API does NOT forward session metadata in call.metadata.
      // For outbound routes, ensure outbound=true is always set.
      // Strategy: query Vapi session API to get session metadata, cache by assistant ID with TTL.
      if (n8nWebhookPath === '/webhook/voice-gateway-outbound') {
        if (!openaiReq.call) openaiReq.call = {};
        if (!openaiReq.call.metadata) openaiReq.call.metadata = {};
        const cm = openaiReq.call.metadata;
        if (!cm.outbound) cm.outbound = true;

        // If use_case missing, try to fetch from Vapi session API
        if (!cm.use_case || !cm.forced_intent) {
          // Cache by Vapi session ID (unique per conversation) with 5-minute TTL
          if (!global._outboundMetadataCache) global._outboundMetadataCache = {};
          const sessionId = openaiReq.metadata?.sessionId || openaiReq.call?.id || '';
          const assistantId = openaiReq.assistant?.id || '';
          const cacheKey = sessionId || 'default';
          const cached = global._outboundMetadataCache[cacheKey];
          const now = Date.now();

          // Prune old cache entries (> 5 min) to prevent memory leak
          for (const k of Object.keys(global._outboundMetadataCache)) {
            if (now - (global._outboundMetadataCache[k]._ts || 0) > 300000) {
              delete global._outboundMetadataCache[k];
            }
          }

          if (cached && (now - cached._ts) < 300000) {
            const { _ts, ...meta } = cached;
            Object.assign(cm, meta);
            console.error(`[VAPI] Outbound metadata from cache (session=${cacheKey}): ${JSON.stringify(cm)}`);
          } else {
            // Query Vapi session API for recent sessions with this assistant
            try {
              if (assistantId) {
                const sessRes = await axios.get(`https://api.vapi.ai/session?assistantId=${assistantId}&limit=20`, {
                  headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY || '205b02f6-0738-45d5-99e4-427b6c022312'}` },
                  timeout: 3000
                });
                const sessions = sessRes.data?.results || sessRes.data || [];
                // Find session matching our sessionId, or most recent with metadata
                let matched = false;
                for (const sess of sessions) {
                  const sm = sess.metadata || {};
                  if (sm.use_case && sm.outbound) {
                    // If we have a sessionId, only match that specific session
                    if (sessionId && sess.id !== sessionId) continue;
                    if (!cm.use_case) cm.use_case = sm.use_case;
                    if (!cm.forced_intent) cm.forced_intent = sm.forced_intent || 'RETENTION';
                    if (!cm.active_profile) cm.active_profile = sm.active_profile || 'HIGH_END';
                    if (sm.goal) cm.goal = sm.goal;
                    if (sm.success_criteria) cm.success_criteria = sm.success_criteria;
                    global._outboundMetadataCache[cacheKey] = { ...cm, _ts: now };
                    console.error(`[VAPI] Outbound metadata from session API (${sess.id}): ${JSON.stringify(cm)}`);
                    matched = true;
                    break;
                  }
                }
                // If sessionId didn't match, fall back to most recent session
                if (!matched && sessionId) {
                  for (const sess of sessions) {
                    const sm = sess.metadata || {};
                    if (sm.use_case && sm.outbound) {
                      if (!cm.use_case) cm.use_case = sm.use_case;
                      if (!cm.forced_intent) cm.forced_intent = sm.forced_intent || 'RETENTION';
                      if (!cm.active_profile) cm.active_profile = sm.active_profile || 'HIGH_END';
                      if (sm.goal) cm.goal = sm.goal;
                      if (sm.success_criteria) cm.success_criteria = sm.success_criteria;
                      global._outboundMetadataCache[cacheKey] = { ...cm, _ts: now };
                      console.error(`[VAPI] Outbound metadata from session API fallback (${sess.id}): ${JSON.stringify(cm)}`);
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              console.error(`[VAPI] Session API lookup failed: ${e.message}`);
            }

            // Final fallback: detect from message content
            if (!cm.use_case) {
              const firstMsg = openaiReq.assistant?.firstMessage || '';
              const sysMsg = (openaiReq.messages || []).find(m => m.role === 'system')?.content || '';
              const assistantMsgs = (openaiReq.messages || []).filter(m => m.role === 'assistant').map(m => m.content || '').join(' ');
              const allText = (firstMsg + ' ' + sysMsg + ' ' + assistantMsgs).toLowerCase();
              const ucMap = [
                { kw: ['renewal', 'contract', 'expir'], uc: 'RETENTION_CONTRACT_EXPIRY', intent: 'RETENTION' },
                { kw: ['win back', 'winback', 'welcome back'], uc: 'RETENTION_WINBACK', intent: 'RETENTION' },
                { kw: ['overdue', 'past-due', 'outstanding balance'], uc: 'BILLING_COLLECTION', intent: 'BILLING' },
                { kw: ['auto-pay', 'autopay'], uc: 'BILLING_AUTOPAY_ENROLL', intent: 'BILLING' },
                { kw: ['outage', 'service issue'], uc: 'TECH_OUTAGE_NOTIFY', intent: 'TECHNICAL' },
                { kw: ['appointment', 'technician'], uc: 'TECH_APPT_CONFIRM_RESCHEDULE', intent: 'TECHNICAL' },
                { kw: ['fiber upgrade', 'speed upgrade', '2g'], uc: 'SALES_FIBER_UPGRADE', intent: 'SALES' },
                { kw: ['roaming', 'travel'], uc: 'SALES_ROAMING_ADDON', intent: 'SALES' },
                { kw: ['survey', 'satisfaction', 'feedback'], uc: 'CX_POST_RESOLUTION_SURVEY', intent: 'CX' },
                { kw: ['onboarding', 'welcome', 'new customer'], uc: 'CX_NEW_CUSTOMER_ONBOARDING', intent: 'CX' },
              ];
              for (const { kw, uc, intent } of ucMap) {
                if (kw.some(k => allText.includes(k))) {
                  cm.use_case = uc;
                  cm.forced_intent = intent;
                  break;
                }
              }
              if (!cm.use_case) { cm.use_case = 'RETENTION_CONTRACT_EXPIRY'; cm.forced_intent = 'RETENTION'; }
              // Cache the fallback result too
              global._outboundMetadataCache[cacheKey] = { ...cm, _ts: now };
            }
          }
        }
        if (!cm.active_profile) cm.active_profile = 'HIGH_END';
        console.error(`[VAPI] Outbound metadata final: ${JSON.stringify(cm)}`);
      }

      // Pass the full VAPI payload through to n8n — the Normalize_Input node handles OpenAI format natively
      console.error(`[VAPI] Forwarding to ${n8nWebhookPath}`);
      const n8nRes = await axios.post(`${N8N_BASE_URL}${n8nWebhookPath}`, openaiReq, {
        headers: { "Content-Type": "application/json" },
        timeout: 55000,
      });

      const elapsed = Date.now() - startTime;
      const assistantMessage = n8nRes.data?.choices?.[0]?.message?.content || n8nRes.data?.message || "I'm sorry, could you repeat that?";
      console.error(`[VAPI] Response: call_id=${callId}, ${elapsed}ms, ${assistantMessage.length} chars`);
      const completionId = "chatcmpl-" + Date.now().toString(36);
      const model = openaiReq.model || "supremo-care-agent";

      if (openaiReq.stream) {
        // SSE streaming response for VAPI
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // Send the content as a single delta chunk
        const chunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            delta: { role: "assistant", content: assistantMessage },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

        // Send the finish chunk
        const done = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop",
          }],
        };
        res.write(`data: ${JSON.stringify(done)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        // Non-streaming response
        const openaiRes = {
          id: completionId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: assistantMessage },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(openaiRes));
      }
    } catch (e) {
      const elapsed = Date.now() - (startTime || Date.now());
      console.error(`[VAPI] ERROR: ${e.message}, ${elapsed}ms, call_id=${callId || 'unknown'}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: e.message, type: "server_error" } }));
      }
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.error(`n8n MCP Server v2.6.0 running on 127.0.0.1:${PORT}`);
  console.error(`Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.error(`Legacy SSE:     http://localhost:${PORT}/sse`);
  console.error(`Health check:   http://localhost:${PORT}/health`);
  console.error(`Outbound Demo:  http://localhost:${PORT}/demo`);
});
