# Security Policy

## Supported versions

Security fixes are provided for the latest release line on `main`.

## Reporting a vulnerability

Please do **not** open public issues for security vulnerabilities.

Email: **hello@gustavonline.com**

Include:
- affected version/commit
- reproduction steps
- impact assessment
- suggested remediation (if any)

We will acknowledge receipt and work on a fix as quickly as possible.

## Security notes

Pi Desktop is a local runtime host and requires filesystem + process permissions to function.
Review `src-tauri/capabilities/default.json` before production/enterprise deployment.
