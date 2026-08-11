import "dotenv/config";

const { FIREFLY_URL, FIREFLY_TOKEN } = process.env;

const endpoint = `${FIREFLY_URL.replace(/\/$/, "")}/api/v1`;

// Retorna uma mensagem específica para cada falha HTTP conhecida da API.
function getConnectionHttpError(status) {
    if (status === 401) {
        return "chave da API ausente, inválida ou expirada (HTTP 401).";
    }

    if (status === 403) {
        return "a chave da API não tem permissão para acessar o recurso (HTTP 403).";
    }

    if (status === 404) {
        return "endpoint não encontrado; confira a FIREFLY_URL (HTTP 404).";
    }

    if (status === 429) {
        return "limite de requisições da API excedido (HTTP 429).";
    }

    if (status >= 500) {
        return `o servidor Firefly III apresentou um erro (HTTP ${status}).`;
    }

    return `a API respondeu com um erro inesperado (HTTP ${status}).`;
}

// Retorna uma mensagem específica para falhas de rede conhecidas do fetch.
function getConnectionNetworkError(error) {
    const errorCode = error.cause?.code;

    if (error.name === "TimeoutError") {
        return "tempo limite de 10 segundos excedido.";
    }

    if (errorCode === "ENOTFOUND" || errorCode === "EAI_AGAIN") {
        return `hostname não encontrado ou DNS indisponível (${errorCode}).`;
    }

    if (errorCode === "ECONNREFUSED") {
        return "conexão recusada; confira o endereço, a porta e se o Firefly III está em execução.";
    }

    if (errorCode === "ECONNRESET") {
        return "a conexão foi encerrada pelo servidor antes de concluir o teste.";
    }

    if (errorCode === "ENETUNREACH" || errorCode === "EHOSTUNREACH") {
        return `servidor inacessível pela rede (${errorCode}).`;
    }

    if (errorCode === "ERR_INVALID_URL") {
        return "a FIREFLY_URL não é uma URL válida.";
    }

    const tlsErrorCodes = [
        "CERT_HAS_EXPIRED",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    ];
    if (tlsErrorCodes.includes(errorCode)) {
        return `falha ao validar o certificado HTTPS (${errorCode}).`;
    }

    return error.message;
}

// Testa a conexão autenticada com a API do Firefly III e registra o resultado.
async function testConnection() {
    console.log(
        `==== Testando conexão com Firefly-III ====\nEndpoint: ${endpoint}/about/user\n`,
    );

    try {
        const response = await fetch(`${endpoint}/about/user`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${FIREFLY_TOKEN}`,
                Accept: "application/vnd.api+json",
            },
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            console.error(
                "Falha na conexão com a API do Firefly III:",
                getConnectionHttpError(response.status),
            );
            return false;
        }

        console.log("Conexão com a API do Firefly III realizada com sucesso.");
        return true;
    } catch (error) {
        console.error(
            "Falha na conexão com a API do Firefly III:",
            getConnectionNetworkError(error),
        );
        return false;
    }
}

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
    testConnection,
    transactionExistsByInternalReference,
};
