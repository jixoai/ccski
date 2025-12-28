# `ccski mcp`

Start the MCP server to serve skills as tools.

## Usage

```bash
ccski mcp [options]
```

## Options

- `--transport stdio|http|sse` (default: stdio)
- `--host <host>` / `--port <port>`: HTTP/SSE options
- `--refresh-interval <ms>`: refresh interval
- `--no-refresh`: disable auto refresh
- `--include <token>` / `--exclude <token>`: filter skills
- `--skill-dir <path>`: add extra roots

## Example

```bash
ccski mcp --transport http --port 3333
```
