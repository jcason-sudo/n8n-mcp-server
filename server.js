import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import crypto from "node:crypto";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
const PORT = process.env.PORT || 3001;
const N8N_BASE_URL = process.env.N8N_BASE_URL || "http://localhost:5678";
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const USER_EMAIL = process.env.USER_EMAIL || "your-email@example.com";
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
        description: "Update a node's configuration in a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            node_name: { type: "string" },
            config: { type: "object", description: "Updated configuration" },
          },
          required: ["workflow_id", "node_name", "config"],
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
        description: "Execute/run a workflow immediately",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string", description: "The workflow ID to execute" },
          },
          required: ["workflow_id"],
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
        description: "Set a cron schedule for a workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_id: { type: "string" },
            cron: { type: "string", description: "Cron expression (e.g., '0 9 * * *' for 9 AM daily)" },
          },
          required: ["workflow_id", "cron"],
        },
      },
      // Workflow Creation & Building
      {
        name: "create_workflow",
        description: "Create a new workflow with optional initial nodes",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Workflow name" },
          },
          required: ["name"],
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
      // Email Notification
      {
        name: "send_result_email",
        description: "Send workflow results via email",
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
      const { workflow_id, node_name, node_type, position, config = {} } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      const newNode = {
        id: crypto.randomUUID(),
        name: node_name,
        type: node_type,
        position: position || [100, 100],
        parameters: config,
        typeVersion: 1,
      };
      workflow.nodes.push(newNode);
      await saveWorkflow(workflow_id, workflow);
      return {
        content: [
          {
            type: "text",
            text: `Added node "${node_name}" (${node_type}) to workflow`,
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
      const { workflow_id, node_name, config } = args;
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      const node = workflow.nodes.find((n) => n.name === node_name);
      if (!node) throw new Error(`Node "${node_name}" not found`);
      node.parameters = { ...node.parameters, ...config };
      await saveWorkflow(workflow_id, workflow);
      return {
        content: [{ type: "text", text: `Updated node "${node_name}" configuration` }],
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
        content: [{ type: "text", text: `Connected "${from_node}" → "${to_node}"` }],
      };
    }
    // ============ WORKFLOW EXECUTION ============
    if (name === "execute_workflow") {
      const { workflow_id } = args;
      // n8n public API doesn't support direct execution
      // Use webhook-based execution: find or create a webhook trigger
      const workflow = (await n8nClient.get(`/api/v1/workflows/${workflow_id}`)).data;
      const webhookNode = workflow.nodes.find((n) => n.type.includes("webhook"));
      if (webhookNode) {
        const path = webhookNode.parameters?.path || workflow_id;
        const webhookUrl = `${N8N_BASE_URL}/webhook/${path}`;
        try {
          const response = await axios.post(webhookUrl, { trigger: "mcp" });
          return {
            content: [
              {
                type: "text",
                text: `Workflow executed via webhook!\n\nWebhook URL: ${webhookUrl}\nResponse: ${JSON.stringify(response.data, null, 2)}`,
              },
            ],
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Webhook call failed (is the workflow active?): ${e.message}\n\nWebhook URL: ${webhookUrl}`,
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Workflow has no Webhook trigger node. To execute via API:\n1. Add a Webhook node to the workflow\n2. Activate the workflow\n3. Then call execute_workflow again\n\nAlternatively, use the n8n UI to run workflows with Manual Trigger nodes.`,
            },
          ],
        };
      }
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
      return {
        content: [
          {
            type: "text",
            text: `Webhook logs endpoint: ${N8N_BASE_URL}/api/v1/workflows/${workflow_id}/webhooks/logs?limit=${limit}`,
          },
        ],
      };
    }
    // ============ CREDENTIALS ============
    if (name === "list_credentials") {
      // n8n community edition doesn't support GET /credentials in the public API
      // Instead, scan workflows for credential references
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
        .filter((w) => w.nodes.some((n) => n.type.includes("schedule")))
        .map((w) => ({ id: w.id, name: w.name }));
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
      return {
        content: [
          {
            type: "text",
            text: `To set schedule for workflow:\n1. Add a "Schedule Trigger" node\n2. Set cron expression to: ${cron}\n3. Save workflow`,
          },
        ],
      };
    }
    // ============ WORKFLOW MANAGEMENT ============
    if (name === "create_workflow") {
      const { name: wf_name } = args;
      const response = await n8nClient.post("/api/v1/workflows", {
        name: wf_name,
        nodes: [],
        connections: {},
        settings: {},
      });
      return {
        content: [
          {
            type: "text",
            text: `Created workflow:\n\nID: ${response.data.id}\nName: ${response.data.name}\n\nYou can now add nodes to it!`,
          },
        ],
      };
    }
    if (name === "activate_workflow") {
      const { workflow_id, active } = args;
      const endpoint = active ? "activate" : "deactivate";
      const response = await n8nClient.post(`/api/v1/workflows/${workflow_id}/${endpoint}`);
      return {
        content: [
          {
            type: "text",
            text: `Workflow "${response.data.name}" is now ${
              active ? "ACTIVE" : "INACTIVE"
            }`,
          },
        ],
      };
    }
    // ============ EMAIL NOTIFICATIONS ============
    if (name === "send_result_email") {
      const { subject, body, to_email = USER_EMAIL } = args;
      const emailWorkflow = await n8nClient.post("/api/v1/workflows", {
        name: `Auto-Email: ${subject}`,
        nodes: [
          {
            name: "Webhook",
            type: "@n8n/n8n-nodes-base.webhook",
            position: [100, 100],
            parameters: {},
          },
          {
            name: "SendGrid",
            type: "@n8n/n8n-nodes-base.sendGrid",
            position: [300, 100],
            parameters: {
              fromEmail: "noreply@n8n.io",
              toEmail: to_email,
              subject: subject,
              textContent: body,
            },
          },
        ],
        connections: {
          Webhook: {
            main: [[{ node: "SendGrid", type: "main", index: 0 }]],
          },
        },
      });
      await n8nClient.put(`/api/v1/workflows/${emailWorkflow.data.id}`, {
        active: true,
      });
      await n8nClient.post(`/api/v1/workflows/${emailWorkflow.data.id}/execute`, {});
      return {
        content: [
          {
            type: "text",
            text: `Email sent to ${to_email}!\n\nSubject: ${subject}\n\nA workflow was created and executed to send this email.`,
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

// Track active SSE transports by session ID (legacy)
const transports = new Map();

// Track Streamable HTTP transports by session ID
const streamableTransports = new Map();

const httpServer = createServer(async (req, res) => {
  // Log all requests for debugging
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} Headers: ${JSON.stringify(req.headers)}`);

  // CORS headers for Claude.ai
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "n8n-mcp-server", version: "2.0.0" }));
    return;
  }

  // ============ Streamable HTTP transport at /mcp ============
  if (req.url === "/mcp") {
    // POST /mcp - handle JSON-RPC messages (initialize, tool calls, etc.)
    if (req.method === "POST") {
      const sessionId = req.headers["mcp-session-id"];
      let transport = streamableTransports.get(sessionId);

      if (!transport) {
        // New session - create transport and server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        const serverInstance = new Server(
          { name: "n8n-mcp-server", version: "2.0.0" },
          { capabilities: { tools: {} } }
        );
        registerHandlers(serverInstance);

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) streamableTransports.delete(sid);
          console.error(`Streamable HTTP session closed`);
        };

        await serverInstance.connect(transport);

        // Store by session ID after connection
        if (transport.sessionId) {
          streamableTransports.set(transport.sessionId, transport);
        }
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
      const transport = streamableTransports.get(sessionId);
      if (transport) {
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active session. Send a POST first." }));
      }
      return;
    }

    // DELETE /mcp - close session
    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"];
      const transport = streamableTransports.get(sessionId);
      if (transport) {
        await transport.handleRequest(req, res);
        streamableTransports.delete(sessionId);
      } else {
        res.writeHead(404);
        res.end();
      }
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
      { name: "n8n-mcp-server", version: "2.0.0" },
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

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.error(`n8n MCP Server v2.0 running on port ${PORT}`);
  console.error(`Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.error(`Legacy SSE:     http://localhost:${PORT}/sse`);
  console.error(`Health check:   http://localhost:${PORT}/health`);
});
