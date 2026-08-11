import path from "node:path";
import chokidar from "chokidar";
import { enqueueFile } from "./services/files.js";
import { testConnection } from "./services/firefly.js";

const watchDirectory = path.resolve("watch");
const allowedFiletypes = ["csv", "zip", "ofx"];

// Inicia o monitoramento e configura os eventos dos arquivos observados.
function startWatcher() {
    // Lê arquivos ao inicializar.
    const watcher = chokidar.watch(watchDirectory, {
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100,
        },
    });

    // Fica observando o diretório por arquivos novos após inicialização.
    watcher.on("add", (filePath) => {
        const filetype = path.extname(filePath).slice(1).toLowerCase();
        if (!allowedFiletypes.includes(filetype)) return;

        enqueueFile(filePath);
    });

    // Registra erros emitidos pelo monitor de arquivos.
    watcher.on("error", (error) => {
        console.error("Watcher error:", error);
    });

    console.log(
        `Watching ${watchDirectory} for ${allowedFiletypes.join(", ")} files...`,
    );
}

const isFireflyConnected = await testConnection();

if (isFireflyConnected) {
    startWatcher();
} else {
    console.error("Watcher não iniciado porque a conexão com o Firefly III falhou.");
}
