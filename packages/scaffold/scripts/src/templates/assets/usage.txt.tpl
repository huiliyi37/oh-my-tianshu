Usage: dsh-sdk <command> [options]

Commands:
  start [target] [-- args...]  Import a built module, or boot cordis.yml
  dev [target] [-- args...]    Start with TypeScript and local-plugin source resolution
  build [args...] Run the project's installed tsdown
  config          Interactively edit project features
  create <source> Add an external plugin dependency (pkg@version or github:owner/repo#ref) and mount it in cordis.yml
