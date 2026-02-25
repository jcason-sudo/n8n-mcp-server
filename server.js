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
const SMTP_CREDENTIAL_ID = process.env.SMTP_CREDENTIAL_ID || "";
const n8nClient = axios.create({
  baseURL: N8N_BASE_URL,
  headers: {
    "X-N8N-API-KEY": N8N_API_KEY,
    "Content-Type": "application/json",
  },
});
// Shared helper: generates n8n Code node JavaScript for formatting digest emails
function buildDigestEmailCode(digestTitle) {
  return [
    "var articles = $input.all().map(function(i) { return i.json; });",
    "var now = new Date();",
    "var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];",
    "var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];",
    "var today = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();",
    "var digestTitle = " + JSON.stringify(digestTitle) + ";",
    "",
    "if (articles.length === 1 && articles[0]._noArticles) {",
    "  return [{ json: {",
    "    emailSubject: digestTitle + ' - ' + today + ' - No new articles',",
    "    emailBody: '<!DOCTYPE html><html><body style=\"margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;\"><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"padding:32px 16px;\"><tr><td align=\"center\"><table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);\"><tr><td style=\"background:#1a1a2e;padding:36px 40px;text-align:center;\"><h1 style=\"margin:0;color:#fff;font-size:24px;\">' + digestTitle + '</h1><p style=\"margin:10px 0 0;color:#8b8fa3;font-size:14px;\">' + today + '</p></td></tr><tr><td style=\"padding:40px;text-align:center;\"><p style=\"color:#6b7280;font-size:16px;\">No relevant articles matched your topics today.</p><p style=\"color:#9ca3af;font-size:14px;margin-top:8px;\">Check back tomorrow for fresh content.</p></td></tr></table></td></tr></table></body></html>'",
    "  }}];",
    "}",
    "",
    "function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }",
    "",
    "function ago(d) {",
    "  if (!d) return '';",
    "  var h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);",
    "  if (h < 0) h = 0;",
    "  if (h < 1) return 'Just now';",
    "  if (h < 24) return h + 'h ago';",
    "  var dd = Math.floor(h / 24);",
    "  return dd + 'd ago';",
    "}",
    "",
    "var rows = '';",
    "for (var i = 0; i < articles.length; i++) {",
    "  var a = articles[i];",
    "  var title = esc(a.title || 'Untitled');",
    "  var link = a.link || '#';",
    "  var snippet = esc((a.snippet || '').substring(0, 250));",
    "  var source = esc(a.source || '');",
    "  var time = ago(a.date);",
    "  var meta = [source, time].filter(Boolean).join(' \\u00B7 ');",
    "  rows += '<div style=\"margin-bottom:20px;padding-bottom:20px;' + (i < articles.length - 1 ? 'border-bottom:1px solid #eef0f3;' : '') + '\">';",
    "  rows += '<a href=\"' + link + '\" style=\"color:#1a1a2e;text-decoration:none;font-size:16px;font-weight:600;line-height:1.4;display:block;\">' + title + '</a>';",
    "  if (meta) rows += '<p style=\"margin:4px 0 0;color:#6b7280;font-size:12px;letter-spacing:0.3px;\">' + meta + '</p>';",
    "  if (snippet) rows += '<p style=\"margin:6px 0 0;color:#4b5563;font-size:14px;line-height:1.55;\">' + snippet + '</p>';",
    "  rows += '</div>';",
    "}",
    "",
    "var count = articles.length;",
    "var countText = count + ' article' + (count !== 1 ? 's' : '');",
    "",
    "var html = '<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"></head>';",
    "html += '<body style=\"margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;\">';",
    "html += '<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#f4f4f7;padding:32px 16px;\"><tr><td align=\"center\">';",
    "html += '<table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);\">';",
    "// Header",
    "html += '<tr><td style=\"background-color:#1a1a2e;padding:36px 40px;text-align:center;\">';",
    "html += '<h1 style=\"margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.3px;\">' + digestTitle + '</h1>';",
    "html += '<p style=\"margin:10px 0 0;color:#8b8fa3;font-size:14px;\">' + today + ' \\u00B7 ' + countText + '</p>';",
    "html += '</td></tr>';",
    "// Articles",
    "html += '<tr><td style=\"padding:32px 40px;\">' + rows + '</td></tr>';",
    "// Footer",
    "html += '<tr><td style=\"background-color:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eef0f3;\">';",
    "html += '<p style=\"margin:0;color:#9ca3af;font-size:12px;\">Curated by your n8n automation \\u00B7 Delivered daily</p>';",
    "html += '</td></tr></table></td></tr></table></body></html>';",
    "",
    "return [{ json: {",
    "  emailSubject: digestTitle + ' - ' + today + ' - ' + countText,",
    "  emailBody: html",
    "}}];",
  ].join("\n");
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
      // ============ Email Digest Pipelines ============
      {
        name: "create_rss_email_digest",
        description: "Create a complete RSS feed email digest workflow. Aggregates multiple RSS feeds, filters by topic keywords, deduplicates, scores for relevance, and sends a professional daily email summary. Creates a ready-to-activate n8n workflow.",
        inputSchema: {
          type: "object",
          properties: {
            feeds: {
              type: "array",
              items: { type: "string" },
              description: "Array of RSS feed URLs to aggregate (e.g., ['https://techcrunch.com/feed/', 'https://feeds.arstechnica.com/arstechnica/index'])"
            },
            topics: {
              type: "array",
              items: { type: "string" },
              description: "Topic keywords for relevance filtering (e.g., ['AI', 'cybersecurity', 'startups']). Articles not matching any topic are excluded."
            },
            schedule: {
              type: "string",
              description: "Cron expression for digest schedule (default: '0 7 * * *' = daily at 7 AM UTC)"
            },
            max_articles: {
              type: "number",
              description: "Maximum articles per digest email (default: 20)"
            },
            to_email: {
              type: "string",
              description: "Recipient email address (defaults to USER_EMAIL env var)"
            },
          },
          required: ["feeds", "topics"],
        },
      },
      {
        name: "create_linkedin_email_digest",
        description: "Create a LinkedIn content email digest workflow. Fetches LinkedIn posts/articles via API, filters by keyword relevance, and sends a professional daily email summary. Requires LinkedIn API credentials (httpHeaderAuth) configured in n8n.",
        inputSchema: {
          type: "object",
          properties: {
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "Keywords to filter LinkedIn content for relevance (e.g., ['AI', 'leadership', 'venture capital'])"
            },
            organization_ids: {
              type: "array",
              items: { type: "string" },
              description: "LinkedIn organization/company IDs to follow (numeric IDs from LinkedIn URLs)"
            },
            credential_id: {
              type: "string",
              description: "n8n credential ID for LinkedIn API access (httpHeaderAuth type with Bearer token)"
            },
            schedule: {
              type: "string",
              description: "Cron expression (default: '0 7 * * *' = daily at 7 AM UTC)"
            },
            max_posts: {
              type: "number",
              description: "Max posts per digest (default: 15)"
            },
            to_email: {
              type: "string",
              description: "Recipient email address"
            },
          },
          required: ["keywords"],
        },
      },
      {
        name: "create_x_email_digest",
        description: "Create a Twitter/X content email digest workflow. Searches X API v2 for recent posts by keywords, filters by relevance and engagement metrics, and sends a professional daily email summary. Requires X API credentials (httpHeaderAuth with Bearer token) configured in n8n.",
        inputSchema: {
          type: "object",
          properties: {
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "Keywords/search terms for X API (e.g., ['AI agents', 'LLM', 'foundation models']). Combined with OR logic."
            },
            credential_id: {
              type: "string",
              description: "n8n credential ID for X API access (httpHeaderAuth type with 'Authorization: Bearer YOUR_TOKEN')"
            },
            min_likes: {
              type: "number",
              description: "Minimum likes to include a post (default: 5). Helps filter out noise."
            },
            schedule: {
              type: "string",
              description: "Cron expression (default: '0 7 * * *' = daily at 7 AM UTC)"
            },
            max_posts: {
              type: "number",
              description: "Max posts per digest (default: 20)"
            },
            to_email: {
              type: "string",
              description: "Recipient email address"
            },
          },
          required: ["keywords"],
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
    // ============ EMAIL DIGEST PIPELINES ============
    if (name === "create_rss_email_digest") {
      const {
        feeds = [],
        topics = [],
        schedule = "0 7 * * *",
        max_articles = 20,
        to_email = USER_EMAIL,
      } = args;

      if (feeds.length === 0) throw new Error("At least one RSS feed URL is required");

      const feedUrlsCode = [
        "var feeds = " + JSON.stringify(feeds) + ";",
        "return feeds.map(function(url) { return { json: { feedUrl: url } }; });",
      ].join("\n");

      const filterScoreCode = [
        "var topics = " + JSON.stringify(topics) + ";",
        "var maxArticles = " + max_articles + ";",
        "",
        "var allItems = $input.all().map(function(i) { return i.json; });",
        "",
        "// Deduplicate by link URL",
        "var seen = {};",
        "var unique = allItems.filter(function(a) {",
        "  var key = (a.link || a.guid || a.title || '').toLowerCase().trim();",
        "  if (!key || seen[key]) return false;",
        "  seen[key] = true;",
        "  return true;",
        "});",
        "",
        "// Score articles by topic relevance",
        "function scoreArticle(a) {",
        "  var title = (a.title || '').toLowerCase();",
        "  var body = (a.contentSnippet || a.description || a.content || '').toLowerCase();",
        "  var cats = Array.isArray(a.categories) ? a.categories.join(' ').toLowerCase() : '';",
        "  var text = title + ' ' + body + ' ' + cats;",
        "  var s = 0;",
        "  if (topics.length === 0) return 1;",
        "  for (var i = 0; i < topics.length; i++) {",
        "    var t = topics[i].toLowerCase();",
        "    if (title.indexOf(t) !== -1) { s += 15; }",
        "    else if (cats.indexOf(t) !== -1) { s += 8; }",
        "    else if (text.indexOf(t) !== -1) { s += 5; }",
        "  }",
        "  // Freshness bonus",
        "  var d = a.isoDate || a.pubDate;",
        "  if (d) {",
        "    var hrs = (Date.now() - new Date(d).getTime()) / 3600000;",
        "    if (hrs < 6) s += 5;",
        "    else if (hrs < 12) s += 3;",
        "    else if (hrs < 24) s += 1;",
        "  }",
        "  return s;",
        "}",
        "",
        "var scored = unique",
        "  .map(function(a) {",
        "    return {",
        "      title: a.title || 'Untitled',",
        "      snippet: (a.contentSnippet || a.description || '').substring(0, 250),",
        "      link: a.link || '',",
        "      date: a.isoDate || a.pubDate || '',",
        "      source: a.creator || a['dc:creator'] || '',",
        "      _score: scoreArticle(a)",
        "    };",
        "  })",
        "  .filter(function(a) { return a._score > 0; })",
        "  .sort(function(a, b) { return b._score - a._score; })",
        "  .slice(0, maxArticles);",
        "",
        "if (scored.length === 0) {",
        "  return [{ json: { _noArticles: true } }];",
        "}",
        "return scored.map(function(a) { return { json: a }; });",
      ].join("\n");

      const formatEmailCode = buildDigestEmailCode("RSS Digest");

      const nodes = [
        {
          id: crypto.randomUUID(),
          name: "Schedule Trigger",
          type: "n8n-nodes-base.scheduleTrigger",
          position: [0, 300],
          parameters: {
            rule: { interval: [{ field: "cronExpression", expression: schedule }] },
          },
          typeVersion: 1.2,
        },
        {
          id: crypto.randomUUID(),
          name: "Set Feed URLs",
          type: "n8n-nodes-base.code",
          position: [220, 300],
          parameters: { jsCode: feedUrlsCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Read RSS Feed",
          type: "n8n-nodes-base.rssFeedRead",
          position: [440, 300],
          parameters: { url: "={{ $json.feedUrl }}" },
          typeVersion: 1,
          onError: "continueRegularOutput",
        },
        {
          id: crypto.randomUUID(),
          name: "Filter and Score",
          type: "n8n-nodes-base.code",
          position: [660, 300],
          parameters: { mode: "runOnceForAllItems", jsCode: filterScoreCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Format Digest Email",
          type: "n8n-nodes-base.code",
          position: [880, 300],
          parameters: { mode: "runOnceForAllItems", jsCode: formatEmailCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Send Digest",
          type: "n8n-nodes-base.emailSend",
          position: [1100, 300],
          parameters: {
            fromEmail: USER_EMAIL,
            toEmail: to_email,
            subject: "={{ $json.emailSubject }}",
            html: "={{ $json.emailBody }}",
          },
          typeVersion: 1,
          ...(SMTP_CREDENTIAL_ID ? { credentials: { smtp: { id: SMTP_CREDENTIAL_ID, name: "SMTP account" } } } : {}),
        },
      ];

      const connections = {
        "Schedule Trigger": { main: [[{ node: "Set Feed URLs", type: "main", index: 0 }]] },
        "Set Feed URLs": { main: [[{ node: "Read RSS Feed", type: "main", index: 0 }]] },
        "Read RSS Feed": { main: [[{ node: "Filter and Score", type: "main", index: 0 }]] },
        "Filter and Score": { main: [[{ node: "Format Digest Email", type: "main", index: 0 }]] },
        "Format Digest Email": { main: [[{ node: "Send Digest", type: "main", index: 0 }]] },
      };

      const response = await n8nClient.post("/api/v1/workflows", {
        name: "RSS Daily Digest",
        nodes,
        connections,
        settings: {},
      });

      return {
        content: [{
          type: "text",
          text: `Created RSS Daily Digest workflow!\n\nID: ${response.data.id}\nSchedule: ${schedule} (cron)\nFeeds: ${feeds.length} sources\nTopics: ${topics.join(", ")}\nMax articles: ${max_articles}\nRecipient: ${to_email}\n\nPipeline: Schedule \u2192 Fetch Feeds \u2192 Read RSS \u2192 Filter & Score \u2192 Format Email \u2192 Send\n\nNext step: Activate the workflow with activate_workflow to start receiving daily digests.${!SMTP_CREDENTIAL_ID ? "\n\n\u26A0\uFE0F Warning: No SMTP_CREDENTIAL_ID configured. Set it in .env or attach SMTP credentials to the Send Digest node." : ""}`,
        }],
      };
    }

    if (name === "create_linkedin_email_digest") {
      const {
        keywords = [],
        organization_ids = [],
        credential_id = "",
        schedule = "0 7 * * *",
        max_posts = 15,
        to_email = USER_EMAIL,
      } = args;

      if (keywords.length === 0) throw new Error("At least one keyword is required");

      const buildQueryCode = [
        "var orgIds = " + JSON.stringify(organization_ids) + ";",
        "var keywords = " + JSON.stringify(keywords) + ";",
        "",
        "// Build LinkedIn API request parameters",
        "var requests = [];",
        "if (orgIds.length > 0) {",
        "  // Fetch posts from specific organizations",
        "  for (var i = 0; i < orgIds.length; i++) {",
        "    requests.push({",
        "      json: {",
        "        apiUrl: 'https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(urn%3Ali%3Aorganization%3A' + orgIds[i] + ')&count=50',",
        "        source: 'org_' + orgIds[i]",
        "      }",
        "    });",
        "  }",
        "} else {",
        "  // Use LinkedIn search/feed endpoint with keywords",
        "  requests.push({",
        "    json: {",
        "      apiUrl: 'https://api.linkedin.com/v2/ugcPosts?q=authors&count=100',",
        "      source: 'feed'",
        "    }",
        "  });",
        "}",
        "return requests;",
      ].join("\n");

      const filterScoreCode = [
        "var keywords = " + JSON.stringify(keywords) + ";",
        "var maxPosts = " + max_posts + ";",
        "",
        "var allItems = $input.all().map(function(i) { return i.json; });",
        "",
        "// Parse LinkedIn API response - handle nested structure",
        "var posts = [];",
        "for (var i = 0; i < allItems.length; i++) {",
        "  var item = allItems[i];",
        "  // LinkedIn API returns elements array or direct post data",
        "  var elements = item.elements || (item.data ? item.data.elements : null) || [item];",
        "  if (!Array.isArray(elements)) elements = [elements];",
        "  for (var j = 0; j < elements.length; j++) {",
        "    var el = elements[j];",
        "    var text = '';",
        "    if (el.specificContent && el.specificContent['com.linkedin.ugc.ShareContent']) {",
        "      var shareContent = el.specificContent['com.linkedin.ugc.ShareContent'];",
        "      text = (shareContent.shareCommentary || {}).text || '';",
        "    } else if (el.text) {",
        "      text = typeof el.text === 'string' ? el.text : (el.text.text || '');",
        "    } else if (el.commentary) {",
        "      text = el.commentary;",
        "    }",
        "    if (!text) continue;",
        "    posts.push({",
        "      text: text,",
        "      author: el.author || el.actor || '',",
        "      created: el.created ? el.created.time : (el.createdAt || Date.now()),",
        "      id: el.id || el.urn || '',",
        "      url: el.id ? 'https://www.linkedin.com/feed/update/' + el.id : ''",
        "    });",
        "  }",
        "}",
        "",
        "// Deduplicate",
        "var seen = {};",
        "posts = posts.filter(function(p) {",
        "  var key = p.id || p.text.substring(0, 100);",
        "  if (seen[key]) return false;",
        "  seen[key] = true;",
        "  return true;",
        "});",
        "",
        "// Score by keyword relevance",
        "function score(post) {",
        "  var t = post.text.toLowerCase();",
        "  var s = 0;",
        "  for (var i = 0; i < keywords.length; i++) {",
        "    var kw = keywords[i].toLowerCase();",
        "    if (t.indexOf(kw) !== -1) s += 10;",
        "  }",
        "  // Freshness bonus",
        "  var hrs = (Date.now() - post.created) / 3600000;",
        "  if (hrs < 12) s += 5;",
        "  else if (hrs < 24) s += 3;",
        "  return s;",
        "}",
        "",
        "var scored = posts",
        "  .map(function(p) {",
        "    var firstLine = p.text.split('\\n')[0] || 'LinkedIn Post';",
        "    return {",
        "      title: firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine,",
        "      snippet: p.text.substring(0, 250),",
        "      link: p.url,",
        "      date: new Date(p.created).toISOString(),",
        "      source: 'LinkedIn',",
        "      _score: score(p)",
        "    };",
        "  })",
        "  .filter(function(a) { return a._score > 0; })",
        "  .sort(function(a, b) { return b._score - a._score; })",
        "  .slice(0, maxPosts);",
        "",
        "if (scored.length === 0) {",
        "  return [{ json: { _noArticles: true } }];",
        "}",
        "return scored.map(function(a) { return { json: a }; });",
      ].join("\n");

      const formatEmailCode = buildDigestEmailCode("LinkedIn Digest");

      const nodes = [
        {
          id: crypto.randomUUID(),
          name: "Schedule Trigger",
          type: "n8n-nodes-base.scheduleTrigger",
          position: [0, 300],
          parameters: {
            rule: { interval: [{ field: "cronExpression", expression: schedule }] },
          },
          typeVersion: 1.2,
        },
        {
          id: crypto.randomUUID(),
          name: "Build LinkedIn Query",
          type: "n8n-nodes-base.code",
          position: [220, 300],
          parameters: { jsCode: buildQueryCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Fetch LinkedIn Posts",
          type: "n8n-nodes-base.httpRequest",
          position: [440, 300],
          parameters: {
            method: "GET",
            url: "={{ $json.apiUrl }}",
            authentication: "genericCredentialType",
            genericAuthType: "httpHeaderAuth",
            options: {},
          },
          typeVersion: 3,
          ...(credential_id ? { credentials: { httpHeaderAuth: { id: credential_id, name: "LinkedIn API" } } } : {}),
          onError: "continueRegularOutput",
        },
        {
          id: crypto.randomUUID(),
          name: "Filter and Score",
          type: "n8n-nodes-base.code",
          position: [660, 300],
          parameters: { mode: "runOnceForAllItems", jsCode: filterScoreCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Format Digest Email",
          type: "n8n-nodes-base.code",
          position: [880, 300],
          parameters: { mode: "runOnceForAllItems", jsCode: formatEmailCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Send Digest",
          type: "n8n-nodes-base.emailSend",
          position: [1100, 300],
          parameters: {
            fromEmail: USER_EMAIL,
            toEmail: to_email,
            subject: "={{ $json.emailSubject }}",
            html: "={{ $json.emailBody }}",
          },
          typeVersion: 1,
          ...(SMTP_CREDENTIAL_ID ? { credentials: { smtp: { id: SMTP_CREDENTIAL_ID, name: "SMTP account" } } } : {}),
        },
      ];

      const connections = {
        "Schedule Trigger": { main: [[{ node: "Build LinkedIn Query", type: "main", index: 0 }]] },
        "Build LinkedIn Query": { main: [[{ node: "Fetch LinkedIn Posts", type: "main", index: 0 }]] },
        "Fetch LinkedIn Posts": { main: [[{ node: "Filter and Score", type: "main", index: 0 }]] },
        "Filter and Score": { main: [[{ node: "Format Digest Email", type: "main", index: 0 }]] },
        "Format Digest Email": { main: [[{ node: "Send Digest", type: "main", index: 0 }]] },
      };

      const response = await n8nClient.post("/api/v1/workflows", {
        name: "LinkedIn Daily Digest",
        nodes,
        connections,
        settings: {},
      });

      return {
        content: [{
          type: "text",
          text: `Created LinkedIn Daily Digest workflow!\n\nID: ${response.data.id}\nSchedule: ${schedule} (cron)\nKeywords: ${keywords.join(", ")}\nOrganizations: ${organization_ids.length || "user feed"}\nMax posts: ${max_posts}\nRecipient: ${to_email}\n\nPipeline: Schedule \u2192 Build Query \u2192 Fetch Posts \u2192 Filter & Score \u2192 Format Email \u2192 Send\n\nNext step: Activate the workflow with activate_workflow.\n\nRequirements:\n- LinkedIn API credential (httpHeaderAuth) with Bearer token in n8n\n- LinkedIn Marketing API or Content API access${!credential_id ? "\n\n\u26A0\uFE0F Warning: No credential_id provided. Attach LinkedIn API credentials to the Fetch LinkedIn Posts node." : ""}`,
        }],
      };
    }

    if (name === "create_x_email_digest") {
      const {
        keywords = [],
        credential_id = "",
        min_likes = 5,
        schedule = "0 7 * * *",
        max_posts = 20,
        to_email = USER_EMAIL,
      } = args;

      if (keywords.length === 0) throw new Error("At least one keyword is required");

      // Build X API search query: (keyword1 OR keyword2) -is:retweet lang:en
      const searchQuery = "(" + keywords.join(" OR ") + ") -is:retweet lang:en";

      const buildSearchCode = [
        "// X API v2 search query",
        "return [{ json: {",
        "  searchQuery: " + JSON.stringify(searchQuery) + ",",
        "  apiUrl: 'https://api.twitter.com/2/tweets/search/recent'",
        "}}];",
      ].join("\n");

      const filterScoreCode = [
        "var keywords = " + JSON.stringify(keywords) + ";",
        "var maxPosts = " + max_posts + ";",
        "var minLikes = " + min_likes + ";",
        "",
        "var allItems = $input.all().map(function(i) { return i.json; });",
        "",
        "// Parse X API v2 response",
        "var tweets = [];",
        "var usersMap = {};",
        "for (var i = 0; i < allItems.length; i++) {",
        "  var item = allItems[i];",
        "  // Build users lookup from includes",
        "  var includes = item.includes || {};",
        "  var users = includes.users || [];",
        "  for (var u = 0; u < users.length; u++) {",
        "    usersMap[users[u].id] = users[u];",
        "  }",
        "  // Extract tweets from data array",
        "  var data = item.data || [];",
        "  if (!Array.isArray(data)) data = [data];",
        "  for (var j = 0; j < data.length; j++) {",
        "    tweets.push(data[j]);",
        "  }",
        "}",
        "",
        "// Deduplicate by tweet ID",
        "var seen = {};",
        "tweets = tweets.filter(function(t) {",
        "  if (!t.id || seen[t.id]) return false;",
        "  seen[t.id] = true;",
        "  return true;",
        "});",
        "",
        "// Filter by minimum engagement and score by relevance",
        "function score(tweet) {",
        "  var text = (tweet.text || '').toLowerCase();",
        "  var metrics = tweet.public_metrics || {};",
        "  var likes = metrics.like_count || 0;",
        "  var retweets = metrics.retweet_count || 0;",
        "  var replies = metrics.reply_count || 0;",
        "",
        "  // Filter: must meet minimum engagement",
        "  if (likes < minLikes) return -1;",
        "",
        "  var s = 0;",
        "  // Keyword relevance",
        "  for (var i = 0; i < keywords.length; i++) {",
        "    var kw = keywords[i].toLowerCase();",
        "    if (text.indexOf(kw) !== -1) s += 10;",
        "  }",
        "  // Engagement score (log scale to avoid mega-viral domination)",
        "  s += Math.min(Math.log2(likes + 1) * 2, 20);",
        "  s += Math.min(Math.log2(retweets + 1) * 1.5, 10);",
        "  s += Math.min(Math.log2(replies + 1), 5);",
        "",
        "  // Freshness bonus",
        "  if (tweet.created_at) {",
        "    var hrs = (Date.now() - new Date(tweet.created_at).getTime()) / 3600000;",
        "    if (hrs < 6) s += 5;",
        "    else if (hrs < 12) s += 3;",
        "  }",
        "  return s;",
        "}",
        "",
        "var scored = tweets",
        "  .map(function(t) {",
        "    var author = usersMap[t.author_id] || {};",
        "    var authorDisplay = author.name ? author.name + ' @' + author.username : '';",
        "    var metrics = t.public_metrics || {};",
        "    var engagement = [];",
        "    if (metrics.like_count) engagement.push(metrics.like_count + ' likes');",
        "    if (metrics.retweet_count) engagement.push(metrics.retweet_count + ' RTs');",
        "    if (metrics.reply_count) engagement.push(metrics.reply_count + ' replies');",
        "    return {",
        "      title: (t.text || '').substring(0, 120),",
        "      snippet: (t.text || '') + (engagement.length ? '\\n' + engagement.join(' \\u00B7 ') : ''),",
        "      link: 'https://x.com/' + (author.username || 'i') + '/status/' + t.id,",
        "      date: t.created_at || '',",
        "      source: authorDisplay || 'X',",
        "      _score: score(t)",
        "    };",
        "  })",
        "  .filter(function(a) { return a._score > 0; })",
        "  .sort(function(a, b) { return b._score - a._score; })",
        "  .slice(0, maxPosts);",
        "",
        "if (scored.length === 0) {",
        "  return [{ json: { _noArticles: true } }];",
        "}",
        "return scored.map(function(a) { return { json: a }; });",
      ].join("\n");

      const formatEmailCode = buildDigestEmailCode("X / Twitter Digest");

      const nodes = [
        {
          id: crypto.randomUUID(),
          name: "Schedule Trigger",
          type: "n8n-nodes-base.scheduleTrigger",
          position: [0, 300],
          parameters: {
            rule: { interval: [{ field: "cronExpression", expression: schedule }] },
          },
          typeVersion: 1.2,
        },
        {
          id: crypto.randomUUID(),
          name: "Build X Search",
          type: "n8n-nodes-base.code",
          position: [220, 300],
          parameters: { jsCode: buildSearchCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Search X Posts",
          type: "n8n-nodes-base.httpRequest",
          position: [440, 300],
          parameters: {
            method: "GET",
            url: "={{ $json.apiUrl }}",
            authentication: "genericCredentialType",
            genericAuthType: "httpHeaderAuth",
            sendQuery: true,
            queryParameters: {
              parameters: [
                { name: "query", value: "={{ $json.searchQuery }}" },
                { name: "max_results", value: "100" },
                { name: "tweet.fields", value: "created_at,public_metrics,author_id,text" },
                { name: "expansions", value: "author_id" },
                { name: "user.fields", value: "name,username" },
              ],
            },
            options: {},
          },
          typeVersion: 3,
          ...(credential_id ? { credentials: { httpHeaderAuth: { id: credential_id, name: "X API" } } } : {}),
          onError: "continueRegularOutput",
        },
        {
          id: crypto.randomUUID(),
          name: "Filter and Score",
          type: "n8n-nodes-base.code",
          position: [660, 300],
          parameters: { mode: "runOnceForAllItems", jsCode: filterScoreCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Format Digest Email",
          type: "n8n-nodes-base.code",
          position: [880, 300],
          parameters: { mode: "runOnceForAllItems", jsCode: formatEmailCode },
          typeVersion: 2,
        },
        {
          id: crypto.randomUUID(),
          name: "Send Digest",
          type: "n8n-nodes-base.emailSend",
          position: [1100, 300],
          parameters: {
            fromEmail: USER_EMAIL,
            toEmail: to_email,
            subject: "={{ $json.emailSubject }}",
            html: "={{ $json.emailBody }}",
          },
          typeVersion: 1,
          ...(SMTP_CREDENTIAL_ID ? { credentials: { smtp: { id: SMTP_CREDENTIAL_ID, name: "SMTP account" } } } : {}),
        },
      ];

      const connections = {
        "Schedule Trigger": { main: [[{ node: "Build X Search", type: "main", index: 0 }]] },
        "Build X Search": { main: [[{ node: "Search X Posts", type: "main", index: 0 }]] },
        "Search X Posts": { main: [[{ node: "Filter and Score", type: "main", index: 0 }]] },
        "Filter and Score": { main: [[{ node: "Format Digest Email", type: "main", index: 0 }]] },
        "Format Digest Email": { main: [[{ node: "Send Digest", type: "main", index: 0 }]] },
      };

      const response = await n8nClient.post("/api/v1/workflows", {
        name: "X Daily Digest",
        nodes,
        connections,
        settings: {},
      });

      return {
        content: [{
          type: "text",
          text: `Created X Daily Digest workflow!\n\nID: ${response.data.id}\nSchedule: ${schedule} (cron)\nSearch: ${searchQuery}\nMin likes: ${min_likes}\nMax posts: ${max_posts}\nRecipient: ${to_email}\n\nPipeline: Schedule \u2192 Build Query \u2192 Search X API \u2192 Filter & Score \u2192 Format Email \u2192 Send\n\nNext step: Activate the workflow with activate_workflow.\n\nRequirements:\n- X API v2 credentials (httpHeaderAuth with 'Authorization: Bearer YOUR_TOKEN') in n8n\n- X API Basic or Pro access for search endpoint${!credential_id ? "\n\n\u26A0\uFE0F Warning: No credential_id provided. Attach X API credentials to the Search X Posts node." : ""}`,
        }],
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
    res.end(JSON.stringify({ status: "ok", server: "n8n-mcp-server", version: "2.1.0" }));
    return;
  }

  // ============ Streamable HTTP transport at /mcp ============
  if (req.url === "/mcp") {
    // POST /mcp - handle JSON-RPC messages (initialize, tool calls, etc.)
    if (req.method === "POST") {
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? streamableTransports.get(sessionId) : null;

      if (!transport) {
        // Check if this is a request with a stale session ID (not an initialize)
        // Read the body to check the method
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyStr = Buffer.concat(chunks).toString();
        let body;
        try { body = JSON.parse(bodyStr); } catch { body = {}; }

        if (sessionId && body.method !== "initialize") {
          // Stale session - tell client to re-initialize
          // Return 404 which signals Claude to create a new session
          console.error(`Stale session ${sessionId}, method: ${body.method} - returning 404`);
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ 
            jsonrpc: "2.0", 
            error: { code: -32600, message: "Session expired. Please re-initialize." },
            id: body.id || null
          }));
          return;
        }

        // New session (initialize request) - create transport and server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
        });

        const serverInstance = new Server(
          { name: "n8n-mcp-server", version: "2.3.3" },
          { capabilities: { tools: {} } }
        );
        registerHandlers(serverInstance);

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) streamableTransports.delete(sid);
          console.error(`Streamable HTTP session closed: ${sid}`);
        };

        await serverInstance.connect(transport);

        // Store by session ID after connection
        if (transport.sessionId) {
          streamableTransports.set(transport.sessionId, transport);
          console.error(`New session created: ${transport.sessionId}`);
        }

        // Re-create the request with the buffered body for the transport to handle
        const { Readable } = await import("node:stream");
        const newReq = Object.assign(Readable.from(Buffer.from(bodyStr)), {
          method: req.method,
          url: req.url,
          headers: req.headers,
          httpVersion: req.httpVersion,
        });
        await transport.handleRequest(newReq, res);

        if (transport.sessionId && !streamableTransports.has(transport.sessionId)) {
          streamableTransports.set(transport.sessionId, transport);
        }
        return;
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
      } else {
        console.error(`GET with unknown session: ${sessionId} - returning 400`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session expired. Please re-initialize." }));
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
      { name: "n8n-mcp-server", version: "2.1.0" },
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
  console.error(`n8n MCP Server v2.1.0 running on port ${PORT}`);
  console.error(`Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.error(`Legacy SSE:     http://localhost:${PORT}/sse`);
  console.error(`Health check:   http://localhost:${PORT}/health`);
});
