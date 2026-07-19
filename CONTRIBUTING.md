# Contributing

This is a proprietary project (see [LICENSE](LICENSE)). Contributions are only accepted from authorized collaborators.

## Getting started

1. Fork or branch from `master`.
2. Install dependencies: `npm install`.
3. Create a `.env` file as described in the [README](README.md).
4. Run the app locally with `npm run dev`.

## Making changes

1. Create a branch off `master` (e.g. `feature/short-description`, `fix/short-description`).
2. Make your changes, keeping commits focused and descriptive.
3. Open a pull request against `master`.
4. The `build` CI check must pass before merging.

## Code style

- CommonJS modules, following the existing structure under `src/` (`controllers`, `services`, `repositories`, `routes`, `middlewares`, `validations`).
- Validate input with `zod` at the route/validation layer.
- Keep business logic in services, not controllers.
