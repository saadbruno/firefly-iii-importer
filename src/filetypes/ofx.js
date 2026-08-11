import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import ofx from "node-ofx-parser";
import {
	getAccountIdViaNumber,
	submitTransaction,
	transactionExistsByInternalReference,
} from "../services/firefly.js";

// essa função parseia e envia as transações baseadas num arquivo OFX.
// O arquivo OFX pode conter transações de várias contas bancárias num arquivo só.
// Então, esse handler faz um match entre o número da conta que está listado no OFX, e o número da conta que está cadastrado no Firefly-III
// Isso foi testado com OFX do Bradesco exportado via internet banking. Nesse arquivo, o "numero da conta" (ACCTID) no OFX é o numero da agência e da conta numa string só, no formato AG/CCCCCCC (Ex.: 123/7462521)
async function handleOFX(filePath) {
	if (path.extname(filePath).toLowerCase() !== ".ofx") return;

	// aqui a gente primeiro lê o arquivo e confere se é de fato um OFX
	const contents = await readFile(filePath, "utf8");
	const data = ofx.parse(contents);

	if (!data) {
		console.warn(`:: [handleOFX] : Arquivo OFX inválido`);
		return;
	}

	// se o OFX possui mais de uma conta bancária, o STMTTRNRS vira um array.
	// Vamos normalizar esses casos pra ser sempre um array
	const accounts = data.OFX.BANKMSGSRSV1.STMTTRNRS;
	const stmttrnrs = Array.isArray(accounts) ? accounts : [accounts];

	// console.log(stmttrnrs[0].STMTRS.BANKACCTFROM.ACCTID);

	// em teoria OFX é pra ser um padrão multi-bancos. Então não precisamos de um parser específico pra cada banco.
	// Vamos pegar os dados das contas bancárias na API do Firefly, e dar o match pelo número da conta
	// Processa cada conta sequencialmente para evitar envios simultâneos entre contas.
	for (const stmttrnr of stmttrnrs) {
		const acctNumber = stmttrnr.STMTRS.BANKACCTFROM.ACCTID;
		const acctId = await getAccountIdViaNumber(acctNumber);

		if (!acctId) {
			console.warn(
				`:: [handleOFX] : Nenhuma conta no Firefly-III foi encontrada para o número ${acctNumber}`,
			);
		}

		// beleza, aqui então já temos a "conta de ativo" alvo no Firefly-III. Vamos então montar o objeto pra cada transação e enviar à API do Firefly.

		// mesmo problema de múltiplas contas do banco acontece com as transações. Vamos converter pra Array se for uma única transação
		const transactions = stmttrnr.STMTRS.BANKTRANLIST.STMTTRN;
		const stmttrn = Array.isArray(transactions) ? transactions : [transactions];

		// Aguarda cada envio terminar antes de iniciar a próxima transação.
		for (const [i, transaction] of stmttrn.entries()) {
			const internalReference = getInternalReference(transaction);

			// A busca exata evita reenviar uma transação que já foi importada anteriormente.
			if (await transactionExistsByInternalReference(internalReference)) {
				console.log(
					`:: [handleOFX] : ${path.basename(filePath)} : Ignorando transação ${i + 1}/${stmttrn.length}; internal_reference ${internalReference} já importada`,
				);
				continue;
			}

			console.log(
				`:: [handleOFX] : ${path.basename(filePath)} : Importando transação ${i + 1}/${stmttrn.length}`,
			);
			await buildAndSendTransaction(transaction, acctId, internalReference);
		}
	}

	// Move o arquivo somente depois que todas as transações terminarem de importar.
	const parsedFilePath = path.resolve("parsed", path.basename(filePath));
	console.log(
		`:: [handleOFX] : finalizado arquivo ${path.basename(filePath)}. Movendo para pasta parsed...`,
	);
	await rename(filePath, parsedFilePath);
}

// formata a transação do OFX pro formato da API do Firefly-III, e envia pra API
async function buildAndSendTransaction(tr, acctId, internalReference) {
	const date = parseOfxDate(tr.DTPOSTED);

	const formatted = {
		error_if_duplicate_hash: true,
		apply_rules: true,
		transactions: [
			{
				date: date,
				amount: tr.TRNAMT.replaceAll("-", ""),
				description: tr.MEMO,
				internal_reference: internalReference,
				external_id: tr.FITID,
				tags: ["saadbruno/firefly-importer"],
			},
		],
	};

	// para débitos, o source é nossa conta bancária e o destination é a parte envolvida
	// para creditos é o contrário
	if (tr.TRNTYPE === `DEBIT`) {
		formatted.transactions[0].type = `withdrawal`;
		formatted.transactions[0].source_id = acctId;
		formatted.transactions[0].destination_name = getParty(tr.FITID);
	} else {
		formatted.transactions[0].type = `deposit`;
		formatted.transactions[0].source_name = getParty(tr.FITID);
		formatted.transactions[0].destination_id = acctId;
	}

	await submitTransaction(formatted);
	// console.log(transaction);
	// console.log(formatted);
}

// Cria a mesma referência interna usada para identificar e enviar uma transação OFX.
// para o ID da transação, não podemos usar o FITID, pelo menos não para o Bradesco.
// Por algum motivo, o Bradesco cria duas transações (com FITIDs diferentes) para o mesmo resgate do Invest Fácil
// Vamos criar nosso próprio fingerprint da transação baseado nos dados que temos.
// No caso do Invest Fácil, o CHECKNUM é sempre o mesmo, então vamos utilizá-lo pra evitar duplicidade
function getInternalReference(tr) {
	const date = parseOfxDate(tr.DTPOSTED);

	// O Bradesco pode gerar FITIDs diferentes para o mesmo resgate do Invest Fácil.
	return `${tr.CHECKNUM}_${date}_${tr.TRNAMT}`;
}

// Pega o nome da outra parte envolvida na transação
function getParty(memo) {
	const match = memo.match(/[^:]*$/)?.[0].trim();
	const cleaned = match
		.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, "")
		.trim();
	return cleaned;
}

// transforma o formato esquisito da data do OFX em uma data normal
function parseOfxDate(date) {
	const match = date.match(
		/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\[([+-]\d+)(?::[^\]]+)?\]$/,
	);

	if (!match) {
		throw new Error(`Data OFX inválida: ${date}`);
	}

	const [, year, month, day, hour, minute, second, offset] = match;

	const offsetHours = Math.abs(Number(offset)).toString().padStart(2, "0");
	const offsetSign = Number(offset) < 0 ? "-" : "+";

	return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetSign}${offsetHours}:00`;
}

export { handleOFX };
