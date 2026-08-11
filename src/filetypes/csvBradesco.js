import { parse } from "csv-parse/sync";
import { parseBRL, parseDate } from "../services/helpers.js";

// csvData: conteúdo do CSV direto, não o caminho do arquivo
function parseBradescoCSV(csvData) {
	console.log(`Parseando CSV do Bradesco`);

	const rows = parse(csvData, {
		delimiter: ";",
		skip_empty_lines: true,
		trim: true,
		relax_column_count: true,
	});

	for (const row of rows) {
		// FILTROS
		// 1 - Linhas que não são lançamentos não começam com uma data DD/MM/YYYY
		const date = parseDate(row[0]);

		if (!date) {
			console.log(`:: [Bradesco] : Pulando linha: não é uma transação`);
			continue;
		}

		// 2 - Código de transação 0 é só o saldo antes do extrato
		if (row[2] === "0") {
			console.log(
				`:: [Bradesco] : Pulando linha: Apenas saldo antes do início do extrato`,
			);
			continue;
		}

		//	FIM DOS FILTROS

		// Variáveis úteis
		const docto = row[2];

		// o valor da transação é crédito na coluna 3, débito na coluna 4. Os dois valores são positivos,
		// e o separador decimal é vírgula. Vamos criar uma única const pro valor da transação, sendo que
		// crédito é positivo e débito é negativo
		const amount = row[3] ? parseBRL(row[3]) : -parseBRL(row[4]);

		const balance = parseBRL(row[5]);

		// Vamos criar uma fingerprint da transação
		// Não podemos usar apenas docto, pois transações do mesmo tipo tem o mesmo docto (exemplo resgate do InvestFácil)
		// Também não podemos usar só a data, porque o extrato do bradesco não inclui o horário da transação
		// Também não podemos usar só docto + data, nem docto + data + valor, pois podem gerar valores duplicados
		// Então vamos utilizar o saldo da conta como parte da fingerprint também. Isso garante que a fingerprint é única
		const fingerprint = `${date.getFullYear()}_${date.getMonth()}_${date.getDate()}_${docto}_${amount}_${balance}`;
		console.log(fingerprint);

		/**
		 * NOTA: Parei o desenvolvimento dessa função por aqui. O CSV exportado pelo app do Bradesco pra iOS
		 * não exporta o nome do remetente / destinatário no CSV. Então isso se torna meio inútil para uso no Firefly-III
		 * Exemplo: Em vez de aparecer "COMPRA CARTAO VISA - Pão de Açúucar", aparece apenas "COMPRA CARTÃO VISA"
		 *
		 * A solução vai ser usar o OFX exportado pelo Internet Banking via navegador no Desktop.
		 * Queria que fosse possível fazer tudo pelo celular, mas essa limitação não permite isso.
		 */
	}
}

export { parseBradescoCSV };
