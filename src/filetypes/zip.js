import path from "node:path";
import extract from "extract-zip";
import { moveFile } from "../services/helpers.js";

// Extrai um arquivo ZIP na pasta observada e arquiva o ZIP depois da extração bem-sucedida.
async function handleZIP(filePath) {
    if (path.extname(filePath).toLowerCase() !== ".zip") return;

    const absoluteFilePath = path.resolve(filePath);
    const watchDirectory = path.dirname(absoluteFilePath);

    console.log(
        `:: [handleZIP] : extraindo ${path.basename(filePath)} na pasta observada...`,
    );
    await extract(absoluteFilePath, { dir: watchDirectory });

    // O ZIP só é arquivado quando todo o seu conteúdo tiver sido extraído.
    const parsedFilePath = path.resolve("parsed", path.basename(filePath));
    console.log(
        `:: [handleZIP] : finalizado arquivo ${path.basename(filePath)}. Movendo para pasta parsed...`,
    );
    await moveFile(absoluteFilePath, parsedFilePath);
}

export { handleZIP };
