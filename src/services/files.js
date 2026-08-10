import path from "node:path";
import { handleCSV } from "./csv.js";

// esse arquivo é nosso "router". Ele decide o que fazer com cada tipo de arquivo.
async function handleFile(filePath) {
	console.log(`Rodando handleFile para arquivo ${filePath}`);
	const ext = path.extname(filePath).toLowerCase();

	switch (ext) {
		case ".csv":
			console.log(`Arquivo CSV`);
			handleCSV(filePath);
			break;

		case ".zip":
			console.log(`Arquivo ZIP`);
			break;

		default:
			console.log(`Nenhum handler definido para arquivos no formato ${ext}`);
			break;
	}
}

export { handleFile };
