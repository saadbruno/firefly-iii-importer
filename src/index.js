import "dotenv/config";
import { submitTransaction } from "./services/firefly.js";
const { FIREFLY_URL, FIREFLY_TOKEN } = process.env;

if (!FIREFLY_URL || !FIREFLY_TOKEN) {
  console.error("Missing FIREFLY_URL or FIREFLY_TOKEN. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

console.log(`FIREFLY-III IMPORTER`);

// Change these values when you are ready to import a different transaction.
const transaction = {
  error_if_duplicate_hash: true,
  apply_rules: true,
  transactions: [
    {
      type: "withdrawal",
      date: "2026-08-10T12:00:00-03:00",
      amount: "12.51",
      description: "Hardcoded coffee transaction",
      source_name: "Bradesco - SP 197",
      destination_name: "Coffee shop"
    }
  ]
};

submitTransaction(transaction);