import { describe, expect, it } from 'vitest'
import { readMcpServerTomlOwnership } from './config-toml-mcp-servers'

describe('MCP server TOML ownership', () => {
  it.each([
    '[mcp_servers."server.with.dot"]\ncommand = "agent"',
    '[mcp_servers]\n"server.with.dot" = { command = "agent" }',
    'mcp_servers."server.with.dot".command = "agent"',
    '[mcp_servers."server.with.dot".env]\nMODE = "fixture"'
  ])('recognizes the decoded server name in %s', (config) => {
    expect(readMcpServerTomlOwnership(config)).toEqual({
      names: new Set(['server.with.dot']),
      ownsRoot: false
    })
  })

  it('treats a root assignment as ownership of the whole closed table', () => {
    expect(readMcpServerTomlOwnership('"mcp_servers" = { shared = { enabled = false } }')).toEqual({
      names: new Set(),
      ownsRoot: true
    })
  })

  it('ignores apparent keys in strings, arrays and unrelated tables', () => {
    const config = [
      'description = """',
      '[mcp_servers.fake]',
      'mcp_servers = {}',
      '"""',
      'args = [',
      '"mcp_servers.quoted = {}",',
      ']',
      '[profile]',
      'mcp_servers = {}',
      '[mcp_servers.real]',
      'command = "agent"'
    ].join('\n')
    expect(readMcpServerTomlOwnership(config)).toEqual({
      names: new Set(['real']),
      ownsRoot: false
    })
  })
})
