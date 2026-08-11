import path from "node:path";
import chokidar from "chokidar";
import { handleFile } from "./services/files.js";

const watchDirectory = path.resolve("watch");
const allowedFiletypes = ["csv", "zip", "ofx"];

// // Change these values when you are ready to import a different transaction.
// const transaction = {
//   error_if_duplicate_hash: true,
//   apply_rules: true,
//   transactions: [
//     {
//       type: "withdrawal",
//       date: "2026-08-10T12:00:00-03:00",
//       amount: "12.51",
//       description: "Hardcoded coffee transaction",
//       source_name: "Bradesco - SP 197",
//       destination_name: "Coffee shop"
//     }
//   ]
// };

// submitTransaction(transaction);

// Lê arquivos ao inicializar
const watcher = chokidar.watch(watchDirectory, {
    awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
    },
});

// Fica observando o diretório por arquivos novos após inicialização
watcher.on("add", async (filePath) => {
    const filetype = path.extname(filePath).slice(1).toLowerCase();
    if (!allowedFiletypes.includes(filetype)) return;

    await handleFile(filePath);
});

watcher.on("error", (error) => {
    console.error("Watcher error:", error);
});

console.log(
    `Watching ${watchDirectory} for ${allowedFiletypes.join(", ")} files...`,
);
