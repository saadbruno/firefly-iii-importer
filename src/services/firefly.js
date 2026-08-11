import "dotenv/config";

const { FIREFLY_URL, FIREFLY_TOKEN } = process.env;

const endpoint = `${FIREFLY_URL.replace(/\/$/, "")}/api/v1`;

async function submitTransaction(transaction) {
    try {
        const response = await fetch(`${endpoint}/transactions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${FIREFLY_TOKEN}`,
                Accept: "application/vnd.api+json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(transaction),
        });

        const body = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(
                `Firefly III returned ${response.status}: ${JSON.stringify(body)}`,
            );
        }

        console.log(`Imported transaction journal ${body.data.id}.`);
    } catch (error) {
        console.error("Import failed:", error.message);
    }
}

// Confere se uma referência interna já está associada a alguma transação no Firefly III.
async function transactionExistsByInternalReference(internalReference) {
    const query = new URLSearchParams({
        query: `internal_reference_is:"${internalReference}"`,
    });
    const response = await fetch(`${endpoint}/search/transactions?${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${FIREFLY_TOKEN}`,
            Accept: "application/vnd.api+json",
            "Content-Type": "application/json",
        },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            `Firefly III returned ${response.status}: ${JSON.stringify(body)}`,
        );
    }

    return body.data.length > 0;
}

// pega o ID da conta (do Firefly) através do account_number
async function getAccountIdViaNumber(acctNumber) {
    let body;

    try {
        const response = await fetch(`${endpoint}/accounts?type=asset`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${FIREFLY_TOKEN}`,
                Accept: "application/vnd.api+json",
                "Content-Type": "application/json",
            },
        });

        body = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(
                `Firefly III returned ${response.status}: ${JSON.stringify(body)}`,
            );
        }
    } catch (error) {
        console.error(
            "Erro ao pegar contas de ativo no Firefly-III:",
            error.message,
        );
    }

    // se chegamos aqui, FF3 respondeu com uma lista de contas. Vamos fazer o loop e dar o match entre acctNumber e i.attributes.account_number
    return (
        body.data.find(
            (account) => account.attributes.account_number === acctNumber,
        )?.id ?? null
    );
}

export {
    getAccountIdViaNumber,
    submitTransaction,
    transactionExistsByInternalReference,
};
