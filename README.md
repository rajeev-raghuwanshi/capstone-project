# Automated Documentation Sync Capstone

<!-- docs-sync:begin setup -->
### Generated setup contract

- Minimum Node.js major version: 18.
- Listen on `127.0.0.1:3000`; override the port with `PORT`.
- Commands: install `npm install`, start `npm start`, test `npm test`.
- Runtime dependencies: `express`, `ejs`.

Contract SHA-256: `2361dde5e5bc6e39dba91880fa6a2401723effc2a5e5fedd7388d4032e5c53f7`.
<!-- docs-sync:end setup -->

A local learning prototype for managing a product catalogue with a server-rendered Express.js and EJS website. Product records are stored in a local JSON file. A read-only pull-request workflow detects documentation drift and publishes reviewable proposals as workflow artifacts; it does not apply or merge documentation changes automatically.

## Requirements

- Node.js 18 or later
- npm

The application has no login, payment, cart, or order features. It is unauthenticated and binds to loopback for local use only; do not expose it to a network.

## Setup and Run

Install dependencies:

```powershell
npm install
```

Start the application:

```powershell
npm start
```

Open <http://127.0.0.1:3000>. The application binds to `127.0.0.1`. The port defaults to `3000`; set the `PORT` environment variable to use another port.

Run the automated tests:

```powershell
npm test
```

Run the local documentation checks and proposal review tools:

```powershell
node docs-sync/validate-markdown.js
node docs-sync/compare-docs.js
node docs-sync/review-proposals.js <base-ref> <head-ref>
```

The review command reports proposed changes for human application and review. It does not modify files.

## Product Data

The application creates `data/products.json` as an empty product list when the catalogue first reads the missing file. See [Product Data](docs/product-data.md) for the stored record format, validation behavior, and storage error handling.

## Browser Routes

The application serves HTML pages and form submissions; it does not expose a separate JSON REST API. See the [Browser Route Inventory](docs/routes.md) for paths, inputs, responses, redirects, and local-origin checks.

## Local Use and Errors

Product management is unauthenticated. Keep the server bound to loopback and use it only on the local machine. Storage failures produce a generic error page; diagnostic details are logged by the server. Malformed product data is not silently replaced.
