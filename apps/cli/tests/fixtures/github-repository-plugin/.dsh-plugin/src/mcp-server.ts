import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// The repository root's linter cannot resolve this independently installed
// Git-package dependency; the package's prepack tsc validates the SDK types.
/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
const server = new McpServer({
  name: 'github-repository-plugin-e2e',
  version: '0.0.0',
})

server.registerTool('proof', {
  description: 'Proves that an MCP server compiled from the exact GitHub repository package is active.',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text', text: 'MCP_FROM_GITHUB_REPOSITORY' }],
}))

await server.connect(new StdioServerTransport())
