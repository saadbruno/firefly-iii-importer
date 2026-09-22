import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import chokidar from "chokidar";
import { createUploadApp } from "../src/services/upload.js";

let directory;
let server;
let endpoint;
const token = "test-upload-secret";
const contents = Buffer.from("data,valor\n2026-09-22,42\n");

// Inicializa um servidor HTTP real com pasta temporária e limite pequeno para testes.
before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "firefly-upload-test-"));
    server = createUploadApp({
        watchDirectory: directory,
        token,
        fileSizeLimit: 1024,
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    endpoint = `http://127.0.0.1:${server.address().port}/upload`;
});

// Fecha as conexões e remove somente os arquivos temporários criados pelos testes.
after(async () => {
    if (server?.listening) {
        server.closeAllConnections();
        server.close();
        await once(server, "close");
    }
    if (directory) await rm(directory, { recursive: true, force: true });
});

// Envia um arquivo direto, permitindo substituir headers e bytes em cada cenário.
function sendRaw(filename, body = contents, headers = {}) {
    return fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
            "X-File-Name": filename,
            ...headers,
        },
        body,
    });
}

// Monta o formulário multipart no formato usado pelo Atalhos da Apple.
function formWithFile(filename, body = contents, field = "file") {
    const form = new FormData();
    form.append(field, new Blob([body]), filename);
    return form;
}

// Envia um formulário com o mesmo token dos uploads diretos.
function sendForm(body) {
    return fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
    });
}

// Confirma que a resposta de aceitação corresponde aos bytes persistidos em watch.
async function assertAccepted(response, expectedContents) {
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.status, "accepted");
    assert.equal(path.basename(result.filename), result.filename);
    assert.deepEqual(
        await readFile(path.join(directory, result.filename)),
        expectedContents,
    );
    assert.ok(
        !(await readdir(directory)).some((name) => name.endsWith(".upload")),
    );
    return result.filename;
}

// Garante que a aplicação nunca aceite criar um endpoint sem autenticação.
test("rejeita configuração sem token", () => {
    for (const invalidToken of [undefined, "", "   "]) {
        assert.throws(
            () =>
                createUploadApp({
                    watchDirectory: directory,
                    token: invalidToken,
                }),
            /UPLOAD_TOKEN/,
        );
    }
});

// Rejeita tokens incorretos antes do parser, mesmo quando o corpo excede o limite.
test("exige Bearer válido antes de receber o corpo", async () => {
    const initialFiles = await readdir(directory);
    for (const authorization of [
        "",
        "Bearer wrong",
        "Bearer test-upload-secrex",
        `Basic ${token}`,
    ]) {
        const response = await sendRaw("extrato.csv", Buffer.alloc(2048), {
            Authorization: authorization,
        });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("www-authenticate"), "Bearer");
        assert.ok((await response.json()).error);
    }
    assert.deepEqual(await readdir(directory), initialFiles);
});

for (const extension of ["csv", "OFX", "zip"]) {
    // Verifica cada extensão nos dois modos sem alterar os bytes, inclusive binários.
    test(`recebe ${extension} em formulário e arquivo direto`, async () => {
        const body =
            extension === "zip"
                ? Buffer.from([0x50, 0x4b, 0, 255, 128, 10])
                : contents;
        const formResponse = await sendForm(
            formWithFile(`extrato.${extension}`, body),
        );
        const name = await assertAccepted(formResponse, body);
        assert.ok(name.endsWith(`.${extension.toLowerCase()}`));
        await assertAccepted(await sendRaw(`extrato.${extension}`, body), body);
    });
}

// Exercita uploads simultâneos com o mesmo nome sem perder nenhum dos arquivos.
test("preserva arquivos com nomes repetidos", async () => {
    const bodies = [Buffer.from("primeiro"), Buffer.from("segundo")];
    const responses = await Promise.all(
        bodies.map((body) => sendRaw("extrato.csv", body)),
    );
    const filenames = await Promise.all(
        responses.map((response, index) =>
            assertAccepted(response, bodies[index]),
        ),
    );
    assert.notEqual(filenames[0], filenames[1]);
});

// Impede que um nome enviado pelo cliente escape da pasta de entrada.
test("remove caminhos Unix e Windows do nome recebido", async () => {
    for (const filename of ["../../extrato.csv", "C:\\pasta\\extrato.csv"]) {
        const saved = await assertAccepted(await sendRaw(filename), contents);
        assert.ok(saved.endsWith("-extrato.csv"));
    }
});

// Confirma que uploads recusados não deixam arquivos prontos nem temporários.
test("rejeita extensões inválidas, arquivos vazios e headers ausentes", async () => {
    const initialFiles = await readdir(directory);
    const cases = [
        [await sendRaw("extrato.exe"), 415],
        [await sendForm(formWithFile("extrato.pdf")), 415],
        [await sendRaw("extrato.csv", Buffer.alloc(0)), 400],
        [await sendForm(formWithFile("extrato.csv", Buffer.alloc(0))), 400],
        [await sendRaw(""), 400],
        [await sendForm(new FormData()), 400],
    ];
    for (const [response, status] of cases) {
        assert.equal(response.status, status);
        assert.ok((await response.json()).error);
    }
    assert.deepEqual(await readdir(directory), initialFiles);
});

// Aplica o limite tanto a multipart quanto a corpos de arquivo direto.
test("limita o tamanho de upload nos dois modos", async () => {
    const initialFiles = await readdir(directory);
    const body = Buffer.alloc(1025);
    for (const response of [
        await sendRaw("grande.zip", body),
        await sendForm(formWithFile("grande.zip", body)),
    ]) {
        assert.equal(response.status, 413);
        assert.ok((await response.json()).error);
    }
    await assertAccepted(
        await sendRaw("limite.zip", Buffer.alloc(1024)),
        Buffer.alloc(1024),
    );
    assert.equal((await readdir(directory)).length, initialFiles.length + 1);
});

// Rejeita campos incorretos, múltiplos arquivos e formulários sem boundary.
test("rejeita formulários inválidos sem persistir arquivos", async () => {
    const initialFiles = await readdir(directory);
    const multiple = formWithFile("primeiro.csv");
    multiple.append("file", new Blob([contents]), "segundo.csv");
    const responses = [
        await sendForm(formWithFile("extrato.csv", contents, "wrong")),
        await sendForm(multiple),
        await sendRaw("extrato.csv", contents, {
            "Content-Type": "multipart/form-data",
        }),
        await sendRaw("extrato.csv", "--broken\r\n", {
            "Content-Type": "multipart/form-data; boundary=broken",
        }),
    ];
    for (const response of responses) {
        assert.equal(response.status, 400);
        assert.ok((await response.json()).error);
    }
    assert.deepEqual(await readdir(directory), initialFiles);
});

// Usa Chokidar real para confirmar que o arquivo publicado é detectado já completo.
test("entrega ao watcher o arquivo completo", async () => {
    const watcher = chokidar.watch(directory, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    });
    try {
        await once(watcher, "ready");
        const detected = once(watcher, "add", {
            signal: AbortSignal.timeout(5000),
        });
        const response = await sendForm(formWithFile("monitor.csv"));
        const filename = await assertAccepted(response, contents);
        const [filePath] = await detected;
        assert.equal(filePath, path.join(directory, filename));
        assert.deepEqual(await readFile(filePath), contents);
    } finally {
        await watcher.close();
    }
});
