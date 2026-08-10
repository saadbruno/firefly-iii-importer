# Firefly III single-transaction importer

A minimal Node.js script that sends one hardcoded withdrawal to Firefly III.

## Run it

1. Install [Node.js 18 or newer](https://nodejs.org/).
2. Create a personal access token in Firefly III under **Options > Profile > OAuth > Personal Access Tokens**.
3. Copy `.env.example` to `.env` and set your Firefly III URL and token.
4. Edit the transaction in `index.js`. Ensure `source_name` matches an existing asset account.
5. Run:

   ```sh
   npm install
   npm start
   ```

The transaction is submitted to `POST /api/v1/transactions`. The script enables Firefly III rules and duplicate-hash checking.
