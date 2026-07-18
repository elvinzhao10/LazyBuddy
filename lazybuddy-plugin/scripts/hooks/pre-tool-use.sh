#!/usr/bin/env bash
# pre-tool-use.sh — PreToolUse hook: block dangerous operations, enforce deny/ask rules.
# Applies LazyBuddy's host-neutral deny/ask policy.
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")

# --- DENY: Secret-like paths ---
STRUCTURED_SECRET_PATTERN=$(printf '%s' "$INPUT" | python3 -c '
import json
import sys

PATTERNS = (
    ".env", ".env.local", ".env.production", ".env.staging",
    "credentials.json", "service-account.json", "private.key", "id_rsa",
    ".aws/credentials", ".ssh/id_", ".netrc", ".npmrc",
    "secrets.yml", "secrets.yaml", "config/secrets",
)

try:
    event = json.load(sys.stdin)
    tool_input = event.get("tool_input")
except (json.JSONDecodeError, AttributeError):
    tool_input = None

if not isinstance(tool_input, dict):
    raise SystemExit(0)

def components(path):
    normalized = []
    for component in path.replace("\\", "/").split("/"):
        if not component or component == ".":
            continue
        if component == "..":
            if normalized:
                normalized.pop()
            continue
        normalized.append(component)
    return normalized

def matches(path_components, pattern):
    pattern_components = pattern.split("/")
    limit = len(path_components) - len(pattern_components) + 1
    for start in range(max(limit, 0)):
        candidate = path_components[start:start + len(pattern_components)]
        if all(
            actual.startswith(expected) if expected == "id_" else actual == expected
            for actual, expected in zip(candidate, pattern_components)
        ):
            return True
    return False

for field in ("path", "file_path", "filePath", "filename", "fileName"):
    value = tool_input.get(field)
    if not isinstance(value, str):
        continue
    path_components = components(value)
    for pattern in PATTERNS:
        if matches(path_components, pattern):
            print(pattern)
            raise SystemExit(0)
' 2>/dev/null || true)
if [ -n "$STRUCTURED_SECRET_PATTERN" ]; then
    echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Access to secret-like path blocked: '"$STRUCTURED_SECRET_PATTERN"'. LazyBuddy secret policy denies this operation."}}'
    exit 0
fi

if [ "$TOOL_NAME" = "Bash" ]; then
    BASH_POLICY=$(printf '%s' "$INPUT" | python3 -c '
import json
import re
import shlex
import sys

PATTERNS = (
    ".env", ".env.local", ".env.production", ".env.staging",
    "credentials.json", "service-account.json", "private.key", "id_rsa",
    ".aws/credentials", ".ssh/id_", ".netrc", ".npmrc",
    "secrets.yml", "secrets.yaml", "config/secrets",
)
CONTROL = frozenset(";&|\n(){}`")
REDIRECTS = frozenset((">", ">>", "<", "<<", "<<<", "&>", "&>>", "<>"))
SHELLS = frozenset(("bash", "sh", "zsh", "fish"))
TEXT_EMITTERS = frozenset(("echo", "printf", "print", "println", "say"))
FILE_READERS = frozenset((
    "awk", "bat", "cat", "code", "cmp", "diff", "emacs", "file", "find",
    "grep", "head", "less", "ls", "more", "nano", "nvim", "rg", "sed",
    "stat", "tail", "tee", "vi", "vim", "wc",
))
FILE_MUTATORS = frozenset((
    "chmod", "chgrp", "chown", "cp", "install", "ln", "mkdir", "mv", "rm",
    "tee", "touch",
))
GIT_OPTIONS_WITH_VALUES = frozenset((
    "-C", "--git-dir", "--work-tree", "-c", "--config-env", "--exec-path",
    "--namespace",
))
POSITIONAL_OPTIONS_WITH_VALUES = frozenset((
    "-C", "-D", "-e", "-f", "-F", "-H", "-m", "-o", "-u", "-g",
    "--cache", "--config", "--context", "--directory", "--extra-index-url",
    "--file", "--format", "--group", "--header", "--index-url", "--message",
    "--output", "--pattern", "--prefix", "--registry", "--regexp", "--user",
    "--userconfig", "--workspace", "--workspaces",
))

def emit(kind, value=""):
    print(kind + (":" + value if value else ""))
    raise SystemExit(0)

def path_components(path):
    normalized = []
    for component in path.replace("\\", "/").split("/"):
        if not component or component == ".":
            continue
        if component == "..":
            if normalized:
                normalized.pop()
            continue
        normalized.append(component)
    return normalized

def secret_pattern(path):
    parts = path_components(path)
    for pattern in PATTERNS:
        expected = pattern.split("/")
        limit = len(parts) - len(expected) + 1
        for start in range(max(limit, 0)):
            candidate = parts[start:start + len(expected)]
            if all(
                actual.startswith(wanted) if wanted == "id_" else actual == wanted
                for actual, wanted in zip(candidate, expected)
            ):
                return pattern
    return ""

def tokenize(command):
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|\n(){}<>`")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    lexer.commenters = ""
    return list(lexer)

def split_commands(tokens):
    segments = []
    current = []
    separator = ""
    for token in tokens:
        if token and all(char in CONTROL for char in token):
            if current:
                segments.append((current, separator))
                current = []
            separator = token
            continue
        current.append(token)
    if current:
        segments.append((current, separator))
    return segments

def balanced_subcommand(command, start):
    depth = 1
    quote = ""
    escaped = False
    index = start
    while index < len(command):
        char = command[index]
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif quote:
            if char == quote:
                quote = ""
        elif char in (chr(39), chr(34)):
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return command[start:index], index + 1
        index += 1
    return "", len(command)

def substitution_commands(command):
    nested = []
    quote = ""
    escaped = False
    index = 0
    while index < len(command):
        char = command[index]
        if escaped:
            escaped = False
            index += 1
            continue
        if char == "\\":
            escaped = True
            index += 1
            continue
        if quote == chr(39):
            if char == chr(39):
                quote = ""
            index += 1
            continue
        if quote == chr(34):
            if char == chr(34):
                quote = ""
            elif char == "$" and index + 1 < len(command) and command[index + 1] == "(":
                inner, index = balanced_subcommand(command, index + 2)
                nested.append(inner)
                continue
            index += 1
            continue
        if char in (chr(39), chr(34)):
            quote = char
            index += 1
            continue
        if char == "$" and index + 1 < len(command) and command[index + 1] == "(":
            inner, index = balanced_subcommand(command, index + 2)
            nested.append(inner)
            continue
        if char == "`":
            end = index + 1
            while end < len(command):
                if command[end] == "`" and (end == 0 or command[end - 1] != "\\"):
                    break
                end += 1
            if end < len(command):
                nested.append(command[index + 1:end])
                index = end + 1
                continue
        index += 1
    return nested

def basename(token):
    return token.rsplit("/", 1)[-1].lower()

def unwrap(argv):
    index = 0
    while index < len(argv):
        token = argv[index]
        name = basename(token)
        if "=" in token and not token.startswith("-"):
            index += 1
            continue
        if name in ("command", "builtin", "exec", "nice", "nohup", "time"):
            index += 1
            while index < len(argv) and argv[index] == "--":
                index += 1
            continue
        if name == "sudo":
            index += 1
            while index < len(argv):
                option = argv[index]
                if option in ("-u", "--user", "-g", "--group", "-C", "--chdir"):
                    index += 2
                elif option.startswith("-"):
                    index += 1
                else:
                    break
            continue
        if name == "env":
            index += 1
            while index < len(argv):
                option = argv[index]
                if option == "--":
                    index += 1
                    break
                if option.startswith("-"):
                    index += 1
                elif "=" in option:
                    index += 1
                else:
                    break
            continue
        break
    if index >= len(argv):
        return "", []
    return name, argv[index + 1:]

def shell_script(args):
    for arg_index, arg in enumerate(args[:-1]):
        if arg == "-c" or arg == "--command" or (arg.startswith("-") and not arg.startswith("--") and "c" in arg[1:]):
            return args[arg_index + 1]
    return ""

def command_views(command, depth=0):
    if depth > 2:
        return
    for nested in substitution_commands(command):
        yield from command_views(nested, depth + 1)
    tokens = tokenize(command)
    segments = split_commands(tokens)
    for index, (segment, separator) in enumerate(segments):
        executable, args = unwrap(segment)
        if not executable:
            continue
        yield executable, args
        if executable in SHELLS:
            script = shell_script(args)
            if script:
                yield from command_views(script, depth + 1)
        if executable == "eval":
            for arg in args:
                yield from command_views(arg, depth + 1)
        if executable in SHELLS and separator == "|" and index > 0 and not shell_script(args):
            for arg in segments[index - 1][0]:
                yield from command_views(arg, depth + 1)

def positional_args(args, options_with_values=POSITIONAL_OPTIONS_WITH_VALUES):
    index = 0
    end_options = False
    while index < len(args):
        token = args[index]
        if end_options:
            yield token
            index += 1
            continue
        if token == "--":
            end_options = True
            index += 1
            continue
        if token.startswith("-") and token != "-":
            option = token.split("=", 1)[0]
            index += 2 if option in options_with_values and "=" not in token else 1
            continue
        yield token
        index += 1

def git_subcommand(args):
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            return "", index
        if token in GIT_OPTIONS_WITH_VALUES:
            index += 2
        elif token.startswith("-"):
            index += 1
        else:
            return token.lower(), index
    return "", index

def secret_targets(executable, args):
    if executable in {"awk", "grep", "rg", "sed"}:
        values = list(positional_args(args))
        yield from values[1:]
        return
    if executable in FILE_READERS or executable in FILE_MUTATORS:
        yield from positional_args(args)
        return
    if executable == "git":
        subcommand, index = git_subcommand(args)
        if subcommand in {"add", "checkout", "clean", "diff", "ls-files", "mv", "restore", "rm", "show"}:
            yield from positional_args(args[index + 1:])
        return
    if executable in {"curl", "wget"}:
        for token in args:
            if token.startswith("@"):
                yield token[1:]

def redirect_targets(args):
    for index, token in enumerate(args[:-1]):
        if token in REDIRECTS:
            yield args[index + 1].lstrip("&")

def dangerous_operand(token):
    home = "$" + "HOME"
    braced_home = "$" + "{HOME}"
    return (
        token.startswith("/")
        or token == "~"
        or token.startswith("~/")
        or token == home
        or token.startswith(home + "/")
        or token == braced_home
        or token.startswith(braced_home + "/")
        or ".." in token.replace("\\", "/").split("/")
    )

def git_destructive(executable, args):
    if executable != "git":
        return False
    subcommand, index = git_subcommand(args)
    sub_args = args[index + 1:]
    if subcommand == "push":
        return any(
            option == "-f"
            or option == "--force"
            or option.startswith("--force=")
            or option == "--force-with-lease"
            or option.startswith("--force-with-lease=")
            or option.startswith("+")
            for option in sub_args
        )
    if subcommand == "reset":
        return any(option == "--hard" for option in sub_args)
    return False

def publish_operation(executable, args):
    if executable not in {"npm", "npm.cmd", "pip", "pip3", "pip.exe", "docker"}:
        return False
    first = next(positional_args(args), "")
    return (
        executable in {"npm", "npm.cmd"} and first == "publish"
        or executable in {"pip", "pip3", "pip.exe"} and first == "upload"
        or executable == "docker" and first == "push"
    )

try:
    event = json.load(sys.stdin)
except (json.JSONDecodeError, TypeError, ValueError):
    raise SystemExit(0)

if not isinstance(event, dict):
    raise SystemExit(0)
tool_input = event.get("tool_input")
if not isinstance(tool_input, dict):
    raise SystemExit(0)
command = tool_input.get("command")
if not isinstance(command, str):
    raise SystemExit(0)

try:
    views = list(command_views(command))
except ValueError:
    if re.search(r"(?<![A-Za-z0-9_])rm(?![A-Za-z0-9_])", command):
        emit("delete")
    raise SystemExit(0)

for executable, args in views:
    for target in redirect_targets(args):
        pattern = secret_pattern(target)
        if pattern:
            emit("secret", pattern)

    if executable not in TEXT_EMITTERS:
        for target in secret_targets(executable, args):
            if isinstance(target, str):
                pattern = secret_pattern(target)
                if pattern:
                    emit("secret", pattern)

    if executable == "rm":
        recursive = False
        options = True
        for operand in args:
            if options and operand == "--":
                options = False
                continue
            if options and operand.startswith("-") and operand != "-":
                if operand == "--recursive" or (not operand.startswith("--") and ("r" in operand[1:] or "R" in operand[1:])):
                    recursive = True
                continue
            options = False
            if recursive and dangerous_operand(operand):
                emit("delete")

    if git_destructive(executable, args):
        emit("git")
    if publish_operation(executable, args):
        emit("publish")
' 2>/dev/null || true)

    case "$BASH_POLICY" in
        secret:*)
            pattern=$(printf '%s' "$BASH_POLICY" | cut -d: -f2-)
            echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Access to secret-like path blocked: '"$pattern"'. LazyBuddy secret policy denies this operation."}}'
            exit 0
            ;;
        delete)
            echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive recursive delete denied. LazyBuddy policy requires explicit confirmation."}}'
            exit 0
            ;;
        git)
            echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive git operation denied. LazyBuddy policy requires explicit user confirmation."}}'
            exit 0
            ;;
        publish)
            echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"External publish operation denied. LazyBuddy policy requires approval."}}'
            exit 0
            ;;
    esac
fi

# --- Allow: safe operations pass through ---
exit 0
