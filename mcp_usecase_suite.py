#!/usr/bin/env python3
import json
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests
from jsonschema import Draft7Validator

MCP_URL = os.getenv("MCP_URL", "http://127.0.0.1:3001/mcp")
HEALTH_URL = os.getenv("HEALTH_URL", "http://127.0.0.1:3001/health")
TOKEN = os.getenv("MCP_TOKEN", "REPLACE_ME")


def now_ms() -> int:
    return int(time.time() * 1000)


def mk_headers(session_id: Optional[str] = None) -> Dict[str, str]:
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if session_id:
        headers["mcp-session-id"] = session_id
    return headers


def jsonrpc(id_: Any, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}


def parse_json_or_sse(resp: requests.Response) -> Dict[str, Any]:
    try:
        return resp.json()
    except Exception:
        pass

    text = resp.text or ""
    for line in text.splitlines():
        if line.startswith("data:"):
            payload = line[len("data:") :].strip()
            try:
                return json.loads(payload)
            except Exception:
                continue

    return {"_non_json": True, "status_code": resp.status_code, "text": text[:2000]}


def rpc_post(payload: Dict[str, Any], headers: Dict[str, str]) -> requests.Response:
    return requests.post(MCP_URL, json=payload, headers=headers, timeout=30)


@dataclass
class TestResult:
    name: str
    ok: bool
    detail: str = ""


class MCPClient:
    def __init__(self):
        self.session_id: Optional[str] = None
        self.tools: List[Dict[str, Any]] = []
        self.tool_map: Dict[str, Dict[str, Any]] = {}

    def health(self) -> bool:
        resp = requests.get(HEALTH_URL, timeout=10)
        return resp.status_code == 200

    def initialize(self) -> None:
        payload = jsonrpc(
            f"init-{uuid.uuid4().hex[:8]}",
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "mcp-usecase-suite", "version": "1.0"},
                "capabilities": {},
            },
        )
        resp = rpc_post(payload, mk_headers())
        self.session_id = resp.headers.get("mcp-session-id") or self.session_id
        data = parse_json_or_sse(resp)

        if "error" in data:
            raise RuntimeError(f"initialize failed: {json.dumps(data, indent=2)}")

        # Send both variants for compatibility across MCP server implementations.
        for method in ("notifications/initialized", "initialized"):
            notif = {"jsonrpc": "2.0", "method": method, "params": {}}
            nresp = requests.post(MCP_URL, json=notif, headers=mk_headers(self.session_id), timeout=30)
            self.session_id = nresp.headers.get("mcp-session-id") or self.session_id

    def list_tools(self) -> List[Dict[str, Any]]:
        payload = jsonrpc(f"toolslist-{uuid.uuid4().hex[:8]}", "tools/list", {})
        resp = rpc_post(payload, mk_headers(self.session_id))
        data = parse_json_or_sse(resp)

        if "error" in data:
            raise RuntimeError(f"tools/list failed: {json.dumps(data, indent=2)}")

        tools = data.get("result", {}).get("tools", [])
        self.tools = tools
        self.tool_map = {t.get("name"): t for t in tools if t.get("name")}
        return tools

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        payload = jsonrpc(
            f"call-{name}-{uuid.uuid4().hex[:6]}",
            "tools/call",
            {"name": name, "arguments": arguments},
        )
        resp = rpc_post(payload, mk_headers(self.session_id))
        return parse_json_or_sse(resp)


def find_tool_by_keywords(tool_names: List[str], keywords: List[str]) -> Optional[str]:
    lower = [t.lower() for t in tool_names]
    for i, val in enumerate(lower):
        if all(k in val for k in keywords):
            return tool_names[i]
    for i, val in enumerate(lower):
        if any(k in val for k in keywords):
            return tool_names[i]
    return None


def schema_for_tool(tool: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return tool.get("inputSchema") or tool.get("input_schema") or tool.get("schema")


def build_minimal_args(schema: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    args: Dict[str, Any] = {}
    missing: List[str] = []
    required = schema.get("required", [])
    props = schema.get("properties", {})

    for key in required:
        if key not in props:
            missing.append(key)
            continue
        prop = props[key]
        typ = prop.get("type")
        if typ == "string":
            args[key] = "TEST"
        elif typ in ("integer", "number"):
            args[key] = 1
        elif typ == "boolean":
            args[key] = True
        elif typ == "array":
            args[key] = []
        elif typ == "object":
            args[key] = {}
        else:
            args[key] = "TEST"

    return args, missing


def summarize_rpc(data: Dict[str, Any]) -> str:
    if "_non_json" in data:
        return f"NON_JSON status={data.get('status_code')} text={data.get('text','')[:200]}"
    if "error" in data:
        err = data["error"]
        code = err.get("code")
        err_code = (err.get("data") or {}).get("error_code")
        msg = err.get("message")
        return f"ERROR code={code} error_code={err_code} msg={msg}"

    result = data.get("result")
    preview = json.dumps(result, ensure_ascii=False)[:220] if result is not None else "null"
    return f"OK result_preview={preview}"


def suggest_fix(r: TestResult) -> str:
    detail = (r.detail or "").lower()
    if "initialize" in r.name:
        return "- Ensure initialize returns session id and server accepts notifications/initialized."
    if "tools_list" in r.name:
        return "- Verify tools/list handler and authenticated session propagation."
    if "invalid params" in detail or "invalid_params" in detail:
        return "- Ensure pre-handler AJV validation and JSON-RPC -32602 mapping with invalid_fields."
    if "concurrency" in r.name or "session_concurrency_limit" in detail:
        return "- Ensure per-session in-flight guard and deterministic overflow rejection."
    if "capacity" in r.name or "session_capacity_exceeded" in detail:
        return "- Ensure max sessions + eviction loop + retry_after_ms signaling."
    if "auth" in r.name:
        return "- Verify Bearer-only auth middleware and token handling order."
    return "- Inspect server logs using correlation_id and normalize error mapping for this path."


def print_report(results: List[TestResult]) -> None:
    passed = [r for r in results if r.ok]
    failed = [r for r in results if not r.ok]

    print("\n=== MCP USE CASE SUITE REPORT ===\n")
    print(f"Endpoint: {MCP_URL}")
    print(f"Health:   {HEALTH_URL}\n")
    print(f"PASS: {len(passed)} | FAIL: {len(failed)} | TOTAL: {len(results)}\n")

    for r in results:
        state = "PASS" if r.ok else "FAIL"
        print(f"{state:4}  {r.name:30}  {r.detail}")

    if failed:
        print("\n--- Suggested Fixes (by failure signature) ---")
        for r in failed:
            print(f"\n[{r.name}]")
            print(suggest_fix(r))


def run_suite() -> List[TestResult]:
    out: List[TestResult] = []
    client = MCPClient()

    out.append(TestResult("health_check", client.health(), f"GET {HEALTH_URL}"))

    try:
        client.initialize()
        out.append(TestResult("mcp_initialize", True, f"session_id={client.session_id}"))
    except Exception as exc:
        out.append(TestResult("mcp_initialize", False, str(exc)))
        return out

    try:
        tools = client.list_tools()
        out.append(TestResult("tools_list", True, f"count={len(tools)}"))
    except Exception as exc:
        out.append(TestResult("tools_list", False, str(exc)))
        return out

    tool_names = list(client.tool_map.keys())

    # Validate tool schemas if present
    schema_ok = True
    schema_msgs = []
    for t in client.tools:
        sch = schema_for_tool(t)
        if sch is None:
            continue
        try:
            Draft7Validator.check_schema(sch)
        except Exception as exc:
            schema_ok = False
            schema_msgs.append(f"{t.get('name')}: {exc}")
    out.append(TestResult("tool_schema_validation", schema_ok, "; ".join(schema_msgs) or "all detected schemas valid"))

    candidates = {
        "list_workflows": find_tool_by_keywords(tool_names, ["list", "workflow"]),
        "get_workflow": find_tool_by_keywords(tool_names, ["get", "workflow"]),
        "create_workflow": find_tool_by_keywords(tool_names, ["create", "workflow"]),
        "update_workflow": find_tool_by_keywords(tool_names, ["update", "workflow"]),
        "activate_workflow": find_tool_by_keywords(tool_names, ["activate", "workflow"]),
        "run_workflow": find_tool_by_keywords(tool_names, ["run", "workflow"]) or find_tool_by_keywords(tool_names, ["execute", "workflow"]),
        "validate_workflow": find_tool_by_keywords(tool_names, ["validate", "workflow"]),
    }

    out.append(
        TestResult(
            "capability_probe_n8n",
            True,
            " | ".join([f"{k}={v}" for k, v in candidates.items() if v]) or "no n8n workflow tools detected",
        )
    )

    if candidates["list_workflows"]:
        data = client.call_tool(candidates["list_workflows"], {})
        out.append(TestResult("n8n_list_workflows", "error" not in data, summarize_rpc(data)))
    else:
        out.append(TestResult("n8n_list_workflows", False, "No list workflows tool found"))

    if candidates["get_workflow"]:
        tool = client.tool_map[candidates["get_workflow"]]
        schema = schema_for_tool(tool) or {}
        args, missing = build_minimal_args(schema) if schema else ({}, [])
        if missing:
            out.append(TestResult("n8n_get_workflow_schema_missing", False, f"schema missing required props: {missing}"))
        data = client.call_tool(candidates["get_workflow"], args)
        ok = "error" not in data or ("error" in data and data["error"].get("code") in (-32602, -32010))
        out.append(TestResult("n8n_get_workflow_minimal", ok, summarize_rpc(data)))
    else:
        out.append(TestResult("n8n_get_workflow_minimal", False, "No get workflow tool found"))

    if candidates["create_workflow"]:
        tool = client.tool_map[candidates["create_workflow"]]
        schema = schema_for_tool(tool)
        if schema:
            args, _ = build_minimal_args(schema)
            if "name" in (schema.get("properties") or {}):
                args["name"] = f"mcp-smoke-{uuid.uuid4().hex[:6]}"
            for key in ["workflow", "definition", "data", "json"]:
                if key in (schema.get("properties") or {}):
                    args[key] = {"nodes": [], "connections": {}}
                    break
            data = client.call_tool(candidates["create_workflow"], args)
            out.append(TestResult("n8n_create_workflow_smoke", "error" not in data, summarize_rpc(data)))
        else:
            out.append(TestResult("n8n_create_workflow_smoke", False, "create_workflow has no input schema"))
    else:
        out.append(TestResult("n8n_create_workflow_smoke", True, "Skipped (no create tool)"))

    burst_tool = candidates["list_workflows"] or candidates["get_workflow"]
    if burst_tool:
        failures = 0
        ok = True
        for _ in range(12):
            data = client.call_tool(burst_tool, {})
            if "error" in data and (data["error"].get("data") or {}).get("error_code") == "SESSION_CONCURRENCY_LIMIT":
                continue
            if "error" in data:
                failures += 1
                ok = False
        out.append(TestResult("n8n_burst_calls", ok, f"failures={failures} (concurrency rejections allowed)"))
    else:
        out.append(TestResult("n8n_burst_calls", False, "No safe tool to burst"))

    email_candidates = {
        "send_email": find_tool_by_keywords(tool_names, ["send", "email"]) or find_tool_by_keywords(tool_names, ["smtp"]),
        "list_email": find_tool_by_keywords(tool_names, ["list", "email"]) or find_tool_by_keywords(tool_names, ["imap"]),
        "read_email": find_tool_by_keywords(tool_names, ["read", "email"]) or find_tool_by_keywords(tool_names, ["get", "email"]),
    }

    out.append(
        TestResult(
            "capability_probe_email",
            True,
            " | ".join([f"{k}={v}" for k, v in email_candidates.items() if v]) or "no email tools detected",
        )
    )

    found_email_tool = False
    for key, tool_name in email_candidates.items():
        if not tool_name:
            continue
        found_email_tool = True
        data = client.call_tool(tool_name, {})
        ok = ("error" in data and data["error"].get("code") == -32602) or ("error" not in data)
        out.append(TestResult(f"email_probe_{key}", ok, summarize_rpc(data)))

    if not found_email_tool:
        out.append(TestResult("email_probe_skipped", True, "No email tools exposed (readiness probe only)"))

    return out


if __name__ == "__main__":
    if TOKEN == "REPLACE_ME":
        print("Set MCP_TOKEN env var or edit TOKEN in script.")
        raise SystemExit(2)

    results = run_suite()
    print_report(results)
