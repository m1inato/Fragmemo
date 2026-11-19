// Command lines for agent CLIs, in one place so a CLI upgrade is a one-file change.
// Checked against `claude --help` of Claude Code 2.1.

export function claudeArgs(o: {
  system: string
  mcpUrl: string
  mcpToken: string
  model?: string
  session?: string
}): string[] {
  const mcp = { mcpServers: { fragmemo: { type: 'http', url: o.mcpUrl, headers: { Authorization: `Bearer ${o.mcpToken}` } } } }
  return [
    // The prompt goes in on stdin: no argv length limit, and it stays out of `ps`.
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt', o.system,
    // No built-in tools (files, shell, web): only Fragmemo's tools, all pre-approved.
    '--tools', '',
    '--strict-mcp-config',
    '--mcp-config', JSON.stringify(mcp),
    '--allowedTools', 'mcp__fragmemo',
    '--disable-slash-commands',
    ...(o.model ? ['--model', o.model] : []),
    ...(o.session ? ['--resume', o.session] : [])
  ]
}
