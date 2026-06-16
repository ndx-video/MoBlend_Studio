"""Mount moblend_* MCP tools on the broker FastAPI app."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .mcp_tools import (
    BrokerToolContext,
    moblend_apply_parameters,
    moblend_inspect_template,
    moblend_list_templates,
    moblend_render_preview,
)


class ToolCallRequest(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)


def mount_mcp_tools(app, ctx: BrokerToolContext) -> None:
    """Register MCP-compatible tool routes at /mcp/* and /api/v1/mcp/*."""

    router = APIRouter(tags=["mcp"])

    tools_meta = [
        {
            "name": "moblend_list_templates",
            "description": "List templates from the official library catalog (GET /api/v1/templates).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "query": {"type": "string"},
                },
            },
        },
        {
            "name": "moblend_inspect_template",
            "description": "Load a template and return its manifest parameter schema.",
            "inputSchema": {
                "type": "object",
                "required": ["template_name"],
                "properties": {"template_name": {"type": "string"}},
            },
        },
        {
            "name": "moblend_apply_parameters",
            "description": "Apply delta parameter updates to the currently loaded template.",
            "inputSchema": {
                "type": "object",
                "required": ["parameters"],
                "properties": {"parameters": {"type": "object"}},
            },
        },
        {
            "name": "moblend_render_preview",
            "description": "Render a still JPEG preview of the current template state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "time_seconds": {"type": "number"},
                    "resolution_scale": {"type": "number"},
                },
            },
        },
    ]

    handlers = {
        "moblend_list_templates": lambda args: moblend_list_templates(
            ctx,
            category=args.get("category"),
            query=args.get("query"),
        ),
        "moblend_inspect_template": lambda args: moblend_inspect_template(
            ctx, template_name=args["template_name"]
        ),
        "moblend_apply_parameters": lambda args: moblend_apply_parameters(
            ctx, parameters=args["parameters"]
        ),
        "moblend_render_preview": lambda args: moblend_render_preview(
            ctx,
            time_seconds=float(args.get("time_seconds") or 0.0),
            resolution_scale=float(args.get("resolution_scale") or 1.0),
        ),
    }

    @router.get("/tools")
    def list_tools() -> dict[str, Any]:
        return {"tools": tools_meta}

    @router.post("/tools/{tool_name}")
    def call_tool(tool_name: str, body: ToolCallRequest) -> dict[str, Any]:
        fn = handlers.get(tool_name)
        if fn is None:
            raise HTTPException(status_code=404, detail=f"Unknown tool: {tool_name}")
        try:
            result = fn(body.arguments)
            return {"content": [{"type": "text", "text": _json_text(result)}], "isError": False}
        except KeyError as ex:
            raise HTTPException(status_code=422, detail=f"Missing argument: {ex}") from ex
        except ValueError as ex:
            raise HTTPException(status_code=422, detail=str(ex)) from ex
        except RuntimeError as ex:
            raise HTTPException(status_code=503, detail=str(ex)) from ex

    app.include_router(router, prefix="/mcp")
    app.include_router(router, prefix="/api/v1/mcp")

    # Try FastMCP streamable HTTP when the optional mcp package is available.
    try:
        from mcp.server.fastmcp import FastMCP  # type: ignore[import-not-found]

        mcp = FastMCP("moblend-broker")

        @mcp.tool()
        def moblend_list_templates_tool(
            category: str | None = None, query: str | None = None
        ) -> list[dict[str, Any]]:
            return moblend_list_templates(ctx, category=category, query=query)

        @mcp.tool()
        def moblend_inspect_template_tool(template_name: str) -> dict[str, Any]:
            return moblend_inspect_template(ctx, template_name=template_name)

        @mcp.tool()
        def moblend_apply_parameters_tool(parameters: dict[str, Any]) -> dict[str, Any]:
            return moblend_apply_parameters(ctx, parameters=parameters)

        @mcp.tool()
        def moblend_render_preview_tool(
            time_seconds: float = 0.0, resolution_scale: float = 1.0
        ) -> dict[str, Any]:
            return moblend_render_preview(
                ctx, time_seconds=time_seconds, resolution_scale=resolution_scale
            )

        app.mount("/mcp/stream", mcp.streamable_http_app())
    except Exception:
        pass


def _json_text(value: Any) -> str:
    import json

    return json.dumps(value, indent=2, default=str)