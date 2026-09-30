# Security

Chess Coach runs in your browser and keeps your data in its IndexedDB. The only
server is the local Vite server, which holds the optional tokens in
`.env.local` and never sends them to the browser.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub Security Advisories](https://github.com/gabriel-kohler/chess-coach/security/advisories/new).

Useful to include: what an attacker can do, the steps to reproduce, and the
commit you tested.

## Supported versions

Only the latest commit on `main`.
