import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseBradescoCSV } from "../banks/bradesco.js";
import { parseWiseCSV } from "../banks/wise.js";

async function handleCSV(filePath) {
	if (path.extname(filePath).toLowerCase() !== ".csv") return;

	// arqui a gente primeiro lê o arquivo
	const contents = await readFile(filePath, "utf8");
	const [firstLine = ""] = contents.replace(/^\uFEFF/, "").split(/\r?\n/, 1);

	if (firstLine.includes("TransferWise ID")) {
		return parseWiseCSV(contents);
	}

	const bradescoHeader = /Extrato de:\s*Ag:\s*\d+\s*\|\s*Conta:\s*\d+-\d+/i;
	if (bradescoHeader.test(firstLine)) {
		return parseBradescoCSV(contents);
	}

	console.warn(`Formato de CSV não reconhecido: ${filePath}`);
}

export { handleCSV };
