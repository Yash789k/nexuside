# Contributing

Use Node.js 22 or later and `npm ci`. Run `npm run check` before opening a pull request. Add focused behavior tests when changing the router, provider contracts, approvals, workspace policy, or persistence. Run the browser suite for interface changes and the Docker integration suite for sandbox changes.

Never commit credentials, `.nexus` state, personal workspaces, or provider request recordings. Use synthetic local HTTP fixtures for provider tests. New actions need explicit input schemas, trace events, a documented risk/approval policy, and failure tests. Keep the browser transport and VS Code transport consistent by changing the shared Service rather than adding separate runtime logic.

Report defects with platform, Node/VS Code versions, reproduction steps and a sanitized trace. For sensitive reports, use the repository's private security-reporting option when available; avoid public secret or exploit disclosure in issue text.
