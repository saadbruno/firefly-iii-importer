import path from "node:path";
import { handleCSV } from "../filetypes/csv.js";
import { handleOFX } from "../filetypes/ofx.js";
import { handleZIP } from "../filetypes/zip.js";

const fileQueue = [];
let isProcessingFileQueue = false;

// esse arquivo é nosso "router". Ele decide o que fazer com cada tipo de arquivo.
async function handleFile(filePath) {
    console.log(`Rodando handleFile para arquivo ${filePath}`);
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
        case ".csv":
            console.log(`Arquivo CSV`);
            await handleCSV(filePath);
            break;

        case ".ofx":
            console.log(`Arquivo OFX`);
            await handleOFX(filePath);
            break;

        case ".zip":
            console.log(`Arquivo ZIP`);
            await handleZIP(filePath);
            break;

        default:
            console.log(
                `Nenhum handler definido para arquivos no formato ${ext}`,
            );
            break;
    }
}

// Processa os arquivos enfileirados, aguardando o término de cada um antes de iniciar o próximo.
async function processFileQueue() {
    if (isProcessingFileQueue) return;

    isProcessingFileQueue = true;

    try {
        while (fileQueue.length > 0) {
            const filePath = fileQueue.shift();

            try {
                await handleFile(filePath);
            } catch (error) {
                console.error(`Erro ao processar arquivo ${filePath}:`, error);
            }
        }
    } finally {
        isProcessingFileQueue = false;
    }
}

// Adiciona um arquivo ao fim da fila e inicia o processamento sequencial.
function enqueueFile(filePath) {
    fileQueue.push(filePath);
    void processFileQueue();
}

export { enqueueFile, handleFile };
