# Browser Route Inventory

<!-- docs-sync:begin routes -->
### Generated routes contract

| Method | Path | Purpose | Inputs | Responses |
| --- | --- | --- | --- | --- |
| `GET` | `/` | Display the product catalogue. | None | `200`, `500` |
| `GET` | `/products/new` | Display the create-product form. | None | `200` |
| `POST` | `/products` | Create a product. | `name`, `price`, `description`, `category`, `imageUrl` | `303`, `403`, `422`, `500` |
| `GET` | `/products/:id/edit` | Display the edit-product form. | `id` | `200`, `404`, `500` |
| `POST` | `/products/:id/edit` | Update a product without changing its ID. | `id`, `name`, `price`, `description`, `category`, `imageUrl` | `303`, `403`, `404`, `422`, `500` |
| `GET` | `/products/:id/delete` | Display product deletion confirmation. | `id` | `200`, `404`, `500` |
| `POST` | `/products/:id/delete` | Delete a product after confirmation. | `id` | `303`, `403`, `404`, `500` |
| `GET` | `/products/:id` | Display product details. | `id` | `200`, `404`, `500` |

Contract SHA-256: `9263341b6aab23d96e36cc108426cb29e0308a3c91ff658625d2d2b93ce1cbc7`.
<!-- docs-sync:end routes -->

These are the implemented server-rendered HTML routes. The application does not expose a separate JSON REST API. Product form submissions use URL-encoded form fields.

| Method | Path | Purpose and inputs | Success response | Other responses |
| --- | --- | --- | --- | --- |
| `GET` | `/` | Display the product catalogue; no inputs. | `200 OK`; an empty list displays an empty state. | `500 Internal Server Error` if product storage fails. |
| `GET` | `/products/new` | Display the create form; no inputs. | `200 OK`. | None specific to this route. |
| `POST` | `/products` | Create a product from `name`, `price`, and optional `description`, `category`, and `imageUrl` form fields. | `303 See Other` to `/products/:id` after the record is persisted. | `422 Unprocessable Content` for invalid fields; `403 Forbidden` if the local-origin check fails; `500 Internal Server Error` for storage errors. |
| `GET` | `/products/:id` | Display product details; `id` is the product UUID. | `200 OK`. | `404 Not Found` for malformed or unknown IDs; `500 Internal Server Error` if storage fails. |
| `GET` | `/products/:id/edit` | Display the edit form; `id` is the product UUID. | `200 OK`. | `404 Not Found` for malformed or unknown IDs; `500 Internal Server Error` if storage fails. |
| `POST` | `/products/:id/edit` | Update the product from the same form fields; the existing ID is preserved. | `303 See Other` to `/products/:id` after the update is persisted. | `422 Unprocessable Content` for invalid fields; `404 Not Found` for malformed or unknown IDs; `403 Forbidden` if the local-origin check fails; `500 Internal Server Error` for storage errors. |
| `GET` | `/products/:id/delete` | Show a confirmation page; `id` is the product UUID. This request does not delete the product. | `200 OK`. | `404 Not Found` for malformed or unknown IDs; `500 Internal Server Error` if storage fails. |
| `POST` | `/products/:id/delete` | Confirm deletion; `id` is the product UUID. | `303 See Other` to `/` after deletion is persisted. | `404 Not Found` for malformed or unknown IDs; `403 Forbidden` if the local-origin check fails; `500 Internal Server Error` for storage errors. |

Unknown paths return `404 Not Found`.

## State-Changing Form Protection

Each `POST` route checks the request `Origin` header. If it is absent, the route checks `Referer`. The source must use HTTP, have hostname `localhost` or `127.0.0.1`, and match the server's local port. Missing, malformed, or non-local sources receive `403 Forbidden`.

## Shared Behavior

- Successful page renders return `200 OK`.
- Successful create, update, and delete operations return `303 See Other` only after persistence succeeds.
- Invalid product form input is re-rendered with field errors and `422 Unprocessable Content`.
- Storage errors render a generic `500 Internal Server Error` page without exposing internal paths or stack traces; diagnostic details are logged server-side.
- See [Product Data](product-data.md) for the product fields and persistence format.
