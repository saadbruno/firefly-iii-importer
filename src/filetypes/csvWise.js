import { parse } from "csv-parse/sync";
import {
    submitTransaction,
    transactionExistsByInternalReference,
} from "../services/firefly.js";

async function parseWiseCSV(csvData) {
    console.log(`Parseando CSV do Wise`);

    const parseStartedAt = new Date().toISOString();

    const trs = parse(csvData, {
        delimiter: ",",
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        from_line: 2,
    });

    for (const [i, tr] of trs.entries()) {
        // A primeira coisa é a gente gerar nossa referência interna.
        // Para o Wise, na maioria das vezes podemos usar o TransferWise ID da transação, com algumas exceções:
        // - No Wise, quando você não tem saldo suficiente pra fazer uma compra, ele converte sozinho de outra moeda.
        // Quando isso acontece, o Wise gera duas transações, uma pra cada moeda, mas com o mesmo TransferWise ID.
        // Então, vamos appender a moeda no final da transação, mas só pra compras.
        // - No Wise, qunado um estabelecimento reembolsa a compra, também é o mesmo TransferWise ID. Vamos adicionar "C" ou "D" para credito e debito

        const formatted = {
            error_if_duplicate_hash: true,
            apply_rules: true,
            transactions: [
                {
                    date: tr[2],
                    amount: tr[3].replaceAll("-", ""),
                    description: tr[5],
                    internal_reference: tr[0],
                    external_id: tr[0],
                    tags: [
                        "saadbruno/firefly-importer",
                        `auto-import_${parseStartedAt}`,
                    ],
                },
            ],
        };

        switch (tr[22]) {
            case `CONVERSION`:
                // no caso de conversões, vamos checar se estamos recebendo ou enviando a conversão. No caso de recebimento, o Wise não inclui o valor original enviado,
                // Então não conseguimos registrar com exatidão o valor enviado e recebido.
                // Isso não é um problema porque em teoria vamos importar todos os extrados de todas as moedas do Wise. Então se não pegarmos a conversão no credito, vamos pegar no débito.
                if (tr[21] === `CREDIT`) continue;
                formatted.transactions[0].type = `transfer`;
                formatted.transactions[0].source_name = `${process.env.WISE_FF3_ACCT_PREFIX} - ${tr[8]}`;
                formatted.transactions[0].destination_name = `${process.env.WISE_FF3_ACCT_PREFIX} - ${tr[9]}`;
                formatted.transactions[0].foreign_amount = tr[20];
                formatted.transactions[0].foreign_currency_code = tr[9];
                formatted.transactions[0].notes = `Câmbio: ${tr[10]} | Taxa: ${tr[19]}`;

                break;
            case `CARD`:
                formatted.transactions[0].internal_reference = `${tr[0]}-${tr[4]}-${tr[21]}`;
            default:
                if (tr[21] === `DEBIT`) {
                    formatted.transactions[0].type = `withdrawal`;
                    formatted.transactions[0].source_name = `${process.env.WISE_FF3_ACCT_PREFIX} - ${tr[4]}`;
                    formatted.transactions[0].destination_name = tr[14]
                        ? tr[14]
                        : tr[12]; // 14: Merchant | 12: Payee Name
                } else {
                    formatted.transactions[0].type = `deposit`;
                    formatted.transactions[0].source_name = tr[11]; // Payer Name
                    formatted.transactions[0].destination_name = `${process.env.WISE_FF3_ACCT_PREFIX} - ${tr[4]}`;
                }

                // junta "Payment Reference" + "Description", mas só se não forem vazios
                formatted.transactions[0].description = [tr[6], tr[5]]
                    .filter(Boolean)
                    .join(" - ");
                break;
        }

        // EDGE CASES:
        // Transferência pra Avenue
        if (tr[13] === process.env.AVENUE_ACCT_NO && tr[4] === `USD`) {
            formatted.transactions[0].type = `transfer`;
            formatted.transactions[0].source_name = `${process.env.WISE_FF3_ACCT_PREFIX} - ${tr[4]}`;
            formatted.transactions[0].destination_name =
                process.env.AVENUE_FF3_ACCT_NAME;
            formatted.transactions[0].amount =
                (Number(tr[3]) + Number(tr[19])) * -1;
        }

        // Recebimento de Pix do Bradesco
        // Não há um edge case para ENVIO do Pix no extrado do Bradesco em `ofx.js`. Tem que criar uma regra na interface do FF3 pra excluir essas transações
        if (
            tr[22] === `DEPOSIT` &&
            tr[4] === `BRL` &&
            tr[11] === process.env.WISE_REMETENTE_PIX
        ) {
            formatted.transactions[0].type = `transfer`;
            formatted.transactions[0].source_name =
                process.env.WISE_REMETENTE_PIX_FF3_ACCT_NAME;
            formatted.transactions[0].destination_name = `${process.env.WISE_FF3_ACCT_PREFIX} - ${tr[4]}`;
        }

        console.log(formatted);

        // A busca exata evita reenviar uma transação que já foi importada anteriormente.
        if (
            await transactionExistsByInternalReference(
                formatted.transactions[0].internal_reference,
            )
        ) {
            console.log(
                `:: [parseWiseCSV] : ${trs[0][4]} : Ignorando transação ${i + 1}/${trs.length}; internal_reference ${formatted.transactions[0].internal_reference} já importada`,
            );
            continue;
        }

        console.log(
            `:: [parseWiseCSV] : ${trs[0][4]} : Importando transação ${i + 1}/${trs.length}`,
        );

        await submitTransaction(formatted);
    }
}

export { parseWiseCSV };
