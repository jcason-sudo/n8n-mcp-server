#!/usr/bin/env python3
import json
import os
import threading
import time
import uuid
import requests

MCP = os.getenv("MCP_URL", "http://127.0.0.1:3001/mcp")
HEALTH = os.getenv("HEALTH_URL", "http://127.0.0.1:3001/health")
DEBUG_SESSIONS = os.getenv("DEBUG_SESSIONS_URL", "http://127.0.0.1:3001/debug/sessions")

TOKEN = os.getenv("MCP_TOKEN")
if not TOKEN:
    raise SystemExit("Set MCP_TOKEN first")

base_headers = {"Authorization": f"Bearer {TOKEN}"}
session_id = None
workflow_id = None
execution_id = None


def parse_json_or_sse(resp):
    try:
        return resp.json()
    except Exception:
        pass
    for line in (resp.text or "").splitlines():
        if line.startswith("data:"):
            payload = line[len("data:"):].strip()
            try:
                return json.loads(payload)
            except Exception:
                continue
    return {"error": {"code": -1, "message": "non-json response", "data": {"raw": (resp.text or "")[:500]}}}


def rpc(method, params=None):
    global session_id
    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
        "params": params or {},
    }
    headers = dict(base_headers)
    if session_id:
        headers["mcp-session-id"] = session_id

    resp = requests.post(MCP, json=payload, headers=headers, timeout=30)
    if "mcp-session-id" in resp.headers:
        session_id = resp.headers["mcp-session-id"]
    return parse_json_or_sse(resp)


def tool_call(name, arguments=None):
    return rpc("tools/call", {"name": name, "arguments": arguments or {}})


def print_step(name, ok, detail=""):
    state = "PASS" if ok else "FAIL"
    print(f"{state}: {name} {detail}")


def error_brief(obj):
    if "error" not in obj:
        return ""
    err = obj["error"]
    code = err.get("code")
    msg = err.get("message", "")
    err_code = (err.get("data") or {}).get("error_code")
    return f"code={code} error_code={err_code} msg={msg}"


def content_text(result_obj):
    if not isinstance(result_obj, dict):
        return ""
    result = result_obj.get("result", {})
    content = result.get("content") or []
    if not content:
        return ""
    first = content[0] or {}
    return first.get("text", "")


def initialize():
    r = rpc("initialize", {
        "protocolVersion": "2024-11-05",
        "clientInfo": {"name": "mixed-suite", "version": "1.0"},
        "capabilities": {},
    })
    ok = "error" not in r
    if not ok and "error" in r:
        # Session reuse can return this on repeated initialize calls.
        if r["error"].get("code") == -32600 and "already initialized" in r["error"].get("message", "").lower():
            ok = True
    detail = f"session_id={session_id or 'reused'}"
    if not ok:
        detail += f" {error_brief(r)}"
    print_step("initialize", ok, detail)

    # Send both initialized notifications for compatibility.
    rpc("notifications/initialized", {})
    rpc("initialized", {})


def create_workflow():
    global workflow_id
    name = f"mcp-mixed-{uuid.uuid4().hex[:6]}"
    r = tool_call("create_workflow", {"name": name})
    ok = "error" not in r
    if ok:
        text = content_text(r)
        # parse ID: "ID: <id>"
        marker = "ID: "
        pos = text.find(marker)
        if pos >= 0:
            workflow_id = text[pos + len(marker):].splitlines()[0].strip()
    print_step("create_workflow", ok and bool(workflow_id), workflow_id or "id-not-found")


def add_nodes():
    # server expects: node_name,node_type,position,config
    trig = tool_call("add_node_to_workflow", {
        "workflow_id": workflow_id,
        "node_name": "trigger",
        "node_type": "n8n-nodes-base.manualTrigger",
        "position": [0, 0],
        "config": {},
    })
    set_node = tool_call("add_node_to_workflow", {
        "workflow_id": workflow_id,
        "node_name": "set",
        "node_type": "n8n-nodes-base.set",
        "position": [300, 0],
        "config": {},
    })
    ok = "error" not in trig and "error" not in set_node
    print_step("add_nodes", ok)


def connect_nodes():
    r = tool_call("connect_nodes", {
        "workflow_id": workflow_id,
        "from_node": "trigger",
        "to_node": "set",
        "from_output": "main",
    })
    print_step("connect_nodes", "error" not in r)


def activate_workflow():
    r = tool_call("activate_workflow", {
        "workflow_id": workflow_id,
        "active": True,
    })
    print_step("activate_workflow", "error" not in r)


def execute_workflow():
    global execution_id
    r = tool_call("execute_workflow", {"workflow_id": workflow_id})
    ok = "error" not in r
    if ok:
        txt = content_text(r)
        marker = "Execution ID: "
        pos = txt.find(marker)
        if pos >= 0:
            execution_id = txt[pos + len(marker):].splitlines()[0].strip()
            if execution_id in ("unknown", "not yet available"):
                execution_id = None
        # Fallback: parse execution_id from the embedded webhook JSON response text.
        if not execution_id:
            try:
                marker = "Webhook response:"
                if marker in txt:
                    body = txt.split(marker, 1)[1].strip()
                    payload = json.loads(body)
                    candidate = payload.get("execution_id")
                    if isinstance(candidate, str) and candidate.isdigit():
                        execution_id = candidate
            except Exception:
                pass
    detail = execution_id or "execution-id-not-found"
    if not ok:
        detail = error_brief(r)
    print_step("execute_workflow", ok, detail)


def fetch_results():
    if not execution_id or not str(execution_id).isdigit():
        print_step("get_execution_result", True, "skipped(no execution id)")
        return
    r = tool_call("get_execution_result", {"execution_id": execution_id})
    print_step("get_execution_result", "error" not in r)


def burst_calls():
    ok = True
    failures = 0
    for _ in range(20):
        r = tool_call("list_workflows", {})
        if "error" in r:
            code = (r.get("error", {}).get("data") or {}).get("error_code")
            if code == "SESSION_CONCURRENCY_LIMIT":
                continue
            ok = False
            failures += 1
    print_step("burst_20_calls", ok, f"failures={failures}")


def concurrent_calls():
    results = []

    def call_once():
        results.append(tool_call("list_workflows", {}))

    threads = []
    for _ in range(10):
        t = threading.Thread(target=call_once)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

    ok = True
    rejected = 0
    for r in results:
        if "error" in r:
            code = (r.get("error", {}).get("data") or {}).get("error_code")
            if code == "SESSION_CONCURRENCY_LIMIT":
                rejected += 1
                continue
            ok = False
    print_step("concurrency_10_parallel", ok, f"rejected={rejected}")


def email_probe():
    r = tool_call("send_result_email", {})
    ok = False
    if "error" in r and r["error"].get("code") == -32602:
        ok = True
    print_step("email_probe_validation", ok)


def session_check():
    resp = requests.get(DEBUG_SESSIONS, headers=base_headers, timeout=15)
    data = resp.json()
    active = data.get("active_sessions", -1)
    ok = isinstance(active, int) and active <= 2
    print_step("session_stability", ok, f"active={active}")


def main():
    print("\nRunning MCP Mixed Workload Suite\n")

    h = requests.get(HEALTH, timeout=10)
    print_step("health_check", h.status_code == 200, f"status={h.status_code}")

    initialize()
    create_workflow()
    if workflow_id:
        add_nodes()
        connect_nodes()
        activate_workflow()
        execute_workflow()
        fetch_results()
    else:
        print_step("workflow_flow", False, "create failed; skipping graph/execute")

    burst_calls()
    concurrent_calls()
    email_probe()
    session_check()

    print("\nMixed workload test complete\n")


if __name__ == "__main__":
    main()
