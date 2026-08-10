import "dotenv/config";

const { FIREFLY_URL, FIREFLY_TOKEN } = process.env;

const endpoint = `${FIREFLY_URL.replace(/\/$/, "")}/api/v1/transactions`;

async function submitTransaction(transaction) {
	try {
		const response = await fetch(endpoint, {
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

export { submitTransaction };
