import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { allowedFiletypes } from "../config.js";

const maxFileSize = 25 * 1024 * 1024;

// Cria o endpoint autenticado que recebe um arquivo e o entrega ao monitor.
function createUploadApp({
    watchDirectory,
    token,
    fileSizeLimit = maxFileSize,
}) {
    if (!token?.trim()) {
        throw new Error("UPLOAD_TOKEN não pode estar vazio.");
    }

    const app = express();
    const authorization = Buffer.from(`Bearer ${token}`);
    const multipart = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: fileSizeLimit, files: 1, fields: 0, parts: 2 },
    }).single("file");
    const raw = express.raw({
        type: "*/*",
        limit: fileSizeLimit,
        inflate: false,
    });
    app.disable("x-powered-by");

    // Autentica antes de ler o corpo para não armazenar uploads não autorizados.
    function authenticate(req, res, next) {
        const supplied = Buffer.from(req.get("authorization") || "");
        if (
            supplied.length !== authorization.length ||
            !timingSafeEqual(supplied, authorization)
        ) {
            res.set("WWW-Authenticate", "Bearer");
            return res
                .status(401)
                .json({ error: "Token ausente ou inválido." });
        }
        next();
    }

    // Seleciona o parser de formulário ou de arquivo direto usado pelo Shortcuts.
    function parseUpload(req, res, next) {
        if (req.is("multipart/form-data")) {
            return multipart(req, res, next);
        }
        return raw(req, res, next);
    }

    // Valida o upload e publica o arquivo completo na pasta observada.
    async function receiveUpload(req, res) {
        const originalName = req.file?.originalname || req.get("x-file-name");
        const contents = req.file?.buffer || req.body;
        if (!originalName || !Buffer.isBuffer(contents) || !contents.length) {
            return res.status(400).json({
                error: 'Envie um arquivo no campo "file" ou no corpo com o header X-File-Name.',
            });
        }

        const basename = path.basename(originalName.replaceAll("\\", "/"));
        const extension = path.extname(basename).toLowerCase();
        if (!allowedFiletypes.includes(extension.slice(1))) {
            return res
                .status(415)
                .json({ error: "Use um arquivo CSV, OFX ou ZIP." });
        }

        // Remove caminhos e caracteres especiais; o UUID evita sobrescrever extratos.
        const stem =
            path
                .basename(basename, path.extname(basename))
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .slice(0, 100) || "upload";
        const id = randomUUID();
        const filename = `${id}-${stem}${extension}`;
        const temporaryPath = path.join(watchDirectory, `${id}.upload`);
        await mkdir(watchDirectory, { recursive: true });
        try {
            // A extensão temporária é ignorada pelo watcher; rename publica o arquivo
            // atomicamente no mesmo filesystem, inclusive no bind mount do Docker.
            await writeFile(temporaryPath, contents, {
                flag: "wx",
                mode: 0o600,
            });
            await rename(temporaryPath, path.join(watchDirectory, filename));
        } finally {
            await rm(temporaryPath, { force: true });
        }

        return res.status(202).json({ status: "accepted", filename });
    }

    // Converte falhas de upload em JSON sem expor detalhes internos ou credenciais.
    function handleUploadError(error, _req, res, _next) {
        if (
            error.code === "LIMIT_FILE_SIZE" ||
            error.type === "entity.too.large"
        ) {
            return res
                .status(413)
                .json({ error: "Arquivo excede o limite de upload." });
        }
        if (error instanceof multer.MulterError) {
            return res
                .status(400)
                .json({ error: 'Envie apenas um arquivo no campo "file".' });
        }
        if (error.status >= 400 && error.status < 500) {
            return res
                .status(error.status)
                .json({ error: "Corpo do upload inválido." });
        }
        // O parser multipart não atribui status a erros de estrutura do formulário.
        if (
            error.message === "Unexpected end of form" ||
            error.message === "Multipart: Boundary not found"
        ) {
            return res
                .status(400)
                .json({ error: "Formulário multipart inválido." });
        }
        console.error("Falha ao receber upload:", error);
        return res
            .status(500)
            .json({ error: "Não foi possível salvar o arquivo." });
    }

    // Confirma pelo navegador que o servidor HTTP está respondendo, sem exigir token.
    app.get("/health", (_req, res) => {
        res.set("Cache-Control", "no-store");
        res.json({ status: "ok" });
    });

    app.post("/upload", authenticate, parseUpload, receiveUpload);
    app.use(handleUploadError);
    return app;
}

// Inicia o Express quando há token configurado, preservando o uso apenas da watch.
function startUploadServer(watchDirectory) {
    const token = process.env.UPLOAD_TOKEN;
    if (!token?.trim()) {
        console.log(
            "Uploads HTTP desativados: configure UPLOAD_TOKEN para habilitar.",
        );
        return;
    }

    const port = Number(process.env.HTTP_PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("HTTP_PORT deve ser uma porta entre 1 e 65535.");
    }

    const app = createUploadApp({ watchDirectory, token });
    // Escuta em todas as interfaces para permitir o acesso pelo container Docker.
    const server = app.listen(port, "0.0.0.0", () => {
        console.log(`Uploads HTTP disponíveis na porta ${port}: POST /upload`);
    });
    // Falhas ao abrir a porta devem encerrar o processo para o Docker poder reiniciar.
    server.on("error", (error) => {
        console.error("Falha ao iniciar servidor de uploads:", error);
        process.exit(1);
    });
    return server;
}

export { createUploadApp, startUploadServer };
