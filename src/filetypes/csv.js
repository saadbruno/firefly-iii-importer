import { readFile } from "node:fs/promises";
import path from "node:path";

import { moveFile } from "../services/helpers.js";
import { parseBradescoCSV } from "./csvBradesco.js";
import { parseWiseCSV } from "./csvWise.js";

// Identifica o formato do CSV, processa suas transações e arquiva o arquivo concluído.
async function handleCSV(filePath) {
    if (path.extname(filePath).toLowerCase() !== ".csv") return;

    // aqui a gente primeiro lê o arquivo
    const contents = await readFile(filePath, "utf8");
    const [firstLine = ""] = contents.replace(/^\uFEFF/, "").split(/\r?\n/, 1);

    if (firstLine.includes("TransferWise ID")) {
        await parseWiseCSV(contents);
    } else {
        const bradescoHeader =
            /Extrato de:\s*Ag:\s*\d+\s*\|\s*Conta:\s*\d+-\d+/i;
        if (!bradescoHeader.test(firstLine)) {
            console.warn(`Formato de CSV não reconhecido: ${filePath}`);
            return;
        }

        await parseBradescoCSV(contents);
    }

    // Move apenas arquivos reconhecidos depois que o parser terminar o processamento.
    const parsedFilePath = path.resolve("parsed", path.basename(filePath));
    console.log(
        `:: [handleCSV] : finalizado arquivo ${path.basename(filePath)}. Movendo para pasta parsed...`,
    );
    await moveFile(filePath, parsedFilePath);
}

export { handleCSV };
