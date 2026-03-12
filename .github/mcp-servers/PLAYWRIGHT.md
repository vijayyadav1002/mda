Playwright (Docker) MCP server

Purpose

- Provide a reproducible container that can run Playwright tests against the web app and act as an MCP server for automated test runners.

Files

- docker-compose.playwright.yml — docker-compose service to run a Playwright container that mounts the repo and installs deps.

Quick usage

1. Start the Playwright container (detached):

   docker compose -f .github/mcp-servers/docker-compose.playwright.yml up --build -d

2. Run a single test (example - from host):

   docker compose -f .github/mcp-servers/docker-compose.playwright.yml exec playwright npx playwright test apps/web/tests/example.spec.ts

   Or run a single test by title:

   docker compose -f .github/mcp-servers/docker-compose.playwright.yml exec playwright npx playwright test -g "my test name"

3. Run all Playwright tests (from container):

   docker compose -f .github/mcp-servers/docker-compose.playwright.yml exec playwright npx playwright test

Notes and tips

- The service mounts the repository at /work so tests can run in-context. If tests live in apps/web, run them with paths under that folder.
- The container image installs Playwright browsers on first start (entrypoint runs npx playwright install --with-deps). On CI, prefer building a dedicated image that pre-installs browsers for speed.
- If the web app needs to be available to the container, start the app (npm run dev or docker compose up app) and ensure network reachability. The compose file uses depends_on: app to help ordering, but you may need to start the app separately when developing locally.

Security

- Avoid running tests against production systems with secrets in the same container. Use dedicated test environments or feature flags.

If you'd like, next steps can add a GitHub Actions workflow that uses this compose file to run Playwright on PRs.
