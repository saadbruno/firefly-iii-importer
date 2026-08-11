import { readFile } from "node:fs/promises";
import path from "node:path";
import ofx from "node-ofx-parser";
import {
	getAccountIdViaNumber,
	submitTransaction,
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
	stmttrnrs.forEach(async (stmttrnr) => {
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

		stmttrn.forEach((transaction) => {
			buildAndSendTransaction(transaction, acctId);
		});
	});
}

// formata a transação do OFX pro formato da API do Firefly-III, e envia pra API
function buildAndSendTransaction(transaction, acctId) {
	const formatted = {
		error_if_duplicate_hash: true,
		apply_rules: true,
		transactions: [
			{
				date: parseOfxDate(transaction.DTPOSTED),
				amount: transaction.TRNAMT.replaceAll("-", ""),
				description: transaction.MEMO,
				internal_reference: transaction.FITID,
				external_id: transaction.FITID,
			},
		],
	};

	// para débitos, o source é nossa conta bancária e o destination é a parte envolvida
	// para creditos é o contrário
	if (transaction.TRNTYPE === `DEBIT`) {
		formatted.transactions[0].type = `withdrawal`;
		formatted.transactions[0].source_id = acctId;
		formatted.transactions[0].destination_name = getParty(transaction.FITID);
	} else {
		formatted.transactions[0].type = `deposit`;
		formatted.transactions[0].source_name = getParty(transaction.FITID);
		formatted.transactions[0].destination_id = acctId;
	}

	submitTransaction(formatted);
	// console.log(transaction);
	// console.log(formatted);
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
