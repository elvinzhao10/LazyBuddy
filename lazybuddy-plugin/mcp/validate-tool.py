#!/usr/bin/env python3
"""Validate the advertised tool schema before dispatching a shell request."""
import json
import sys
from typing import Dict, List, Union

JsonValue = Union[None, bool, int, float, str, List["JsonValue"], Dict[str, "JsonValue"]]


def validate(value: JsonValue, schema: Dict[str, JsonValue], location: str = "arguments") -> None:
    kind = schema.get("type")
    valid = {"object": isinstance(value, dict), "array": isinstance(value, list),
             "string": isinstance(value, str), "boolean": isinstance(value, bool),
             "integer": isinstance(value, int) and not isinstance(value, bool),
             "number": isinstance(value, (int, float)) and not isinstance(value, bool)}
    if kind in valid and not valid[kind]:
        raise ValueError(f"{location} must be {kind}")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{location} has an unsupported value")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                raise ValueError(f"missing required argument: {key}")
        for key, definition in schema.get("properties", {}).items():
            if key in value:
                validate(value[key], definition, f"{location}.{key}")
    if isinstance(value, list) and "items" in schema:
        for item in value:
            validate(item, schema["items"], location)


try:
    catalog, name, arguments = sys.argv[1:]
    tools = json.loads(catalog)["tools"]
    tool = next((tool for tool in tools if tool["name"] == name), None)
    if tool is not None:
        validate(json.loads(arguments), tool["inputSchema"])
except (ValueError, TypeError, KeyError) as error:
    print(str(error))
    raise SystemExit(1)
