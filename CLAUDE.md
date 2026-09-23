@AGENTS.md

## Code Navigation

- **Local code (this repo)**: use the `lsai` MCP (`mcp__lsai__*`) for symbol lookup, definitions, references, call graphs and impact analysis. Prefer it over grep/glob for any code navigation; fall back to `rg` only when LSAI has no answer.
- **Third-party libraries**: use the `xmp4` MCP (`xmp4_search`, `xmp4_source`, `xmp4_usages`, `xmp4_callers`, ...) to read real library source, usages and tests instead of guessing from memory.
- See the `lsai` and `xmp4` skills for tool details.
