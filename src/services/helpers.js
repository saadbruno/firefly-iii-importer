// Converte uma data no formato DD/MM/YYYY em Date ou retorna null quando ela é inválida.
function parseDate(dateString) {
    if (typeof dateString !== "string") return null;

    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateString);
    if (!match) return null;

    const [, dayString, monthString, yearString] = match;
    const day = Number(dayString);
    const month = Number(monthString);
    const year = Number(yearString);
    const date = new Date(year, month - 1, day);

    // O Date ajusta automaticamente datas inexistentes; esta validação impede esse comportamento.
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

// transforma strings tipo 1.009,33 num valor numérico
function parseBRL(value) {
    return Number(value.replace(/\./g, "").replace(",", "."));
}

export { parseBRL, parseDate };
