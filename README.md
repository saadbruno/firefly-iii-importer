# Firefly III Importer

Importador automático de extratos bancários para o [Firefly III](https://www.firefly-iii.org/), desenvolvido em Node.js.

O programa observa a pasta `watch`, identifica novos arquivos, converte as transações para o formato da API do Firefly III e processa um arquivo por vez. Depois do processamento, os arquivos reconhecidos são movidos para `parsed`.

## Funcionalidades

- Monitoramento contínuo da pasta `watch` com Chokidar.
- Recebimento de arquivos via `POST /upload`, com token e compatibilidade com Apple Shortcuts.
- Processamento sequencial por meio de uma fila de arquivos.
- Suporte a arquivos `.ofx`, `.csv` e `.zip`.
- Extração automática de ZIPs dentro da pasta observada.
- Importação de OFX com uma ou várias contas e uma ou várias transações.
- Associação de contas OFX às contas de ativo do Firefly III pelo `account_number`.
- Importação de extratos CSV do Wise.
- Identificação de CSVs pelo conteúdo, diferenciando Wise e Bradesco.
- Consulta à API antes de cada envio para evitar duplicidade pelo `internal_reference`.
- Aplicação das regras do Firefly III e da verificação de hash duplicado.
- Tags em cada transação com a origem do importador e a data/hora do lote.
- Arquivamento de arquivos processados na pasta `parsed`.
- Formatação e lint com Biome.

## Formatos suportados

### OFX

O suporte a OFX foi testado com arquivos do Bradesco exportados pelo Internet Banking.

O importador:

- aceita mais de uma conta no mesmo arquivo;
- procura no Firefly III uma conta de ativo cujo `account_number` seja igual ao `ACCTID` do OFX;
- importa débitos como `withdrawal` e créditos como `deposit`;
- cria uma referência interna com `CHECKNUM`, data e valor para evitar transações duplicadas;
- trata `Resgate Fundos Plus di` como transferência da conta de investimentos do Bradesco para a conta corrente.

No Bradesco, o `ACCTID` costuma combinar agência e conta, por exemplo `123/7462521`. Esse mesmo valor deve estar cadastrado no campo de número da conta no Firefly III.

### CSV do Wise

O CSV é reconhecido quando a primeira linha contém `TransferWise ID`.

São importados:

- pagamentos, depósitos e saques;
- compras com cartão;
- conversões entre saldos do Wise, registradas como transferências;
- valores e moedas estrangeiras nas conversões;
- nome do pagador, recebedor ou estabelecimento, quando disponível;
- referência de pagamento e descrição.

Também existem tratamentos específicos para:

- compras que compartilham o mesmo TransferWise ID entre moedas;
- estornos que reutilizam o ID da compra original;
- transferência em USD do Wise para a Avenue;
- recebimento via Pix vindo da conta configurada do Bradesco.

### CSV do Bradesco

O CSV exportado pelo aplicativo do Bradesco é reconhecido, validado e percorrido. O parser ignora cabeçalhos, linhas que não representam lançamentos e a linha de saldo inicial, além de gerar uma fingerprint com data, documento, valor e saldo.

Esse formato ainda **não envia transações ao Firefly III**, pois o CSV do aplicativo omite o nome do remetente ou destinatário. Para importar transações do Bradesco, use o OFX exportado pelo Internet Banking. Após a leitura, o CSV reconhecido é movido para `parsed`.

### ZIP

Arquivos ZIP são extraídos na própria pasta `watch`. Os arquivos `.csv`, `.ofx` ou `.zip` extraídos são detectados pelo monitor e adicionados à fila. Depois de uma extração bem-sucedida, o ZIP original é movido para `parsed`.

## Requisitos

- Node.js 18 ou mais recente.
- Uma instância acessível do Firefly III.
- Um Personal Access Token do Firefly III.
- Contas de ativo previamente criadas no Firefly III com nomes e números compatíveis com a configuração.

O token pode ser criado no Firefly III em **Options > Profile > OAuth > Personal Access Tokens**.

## Configuração

Copie `.env.example` para `.env` e ajuste os valores:

```env
FIREFLY_URL=http://localhost:8080
FIREFLY_TOKEN=replace-with-your-personal-access-token

# Token de upload independente do token do Firefly III. Vazio desativa o HTTP.
UPLOAD_TOKEN=seu-token-de-upload
HTTP_PORT=3000
HTTP_HOST_PORT=3000

# Prefixo usado nos nomes das contas Wise no Firefly III.
WISE_FF3_ACCT_PREFIX="Wise"

# Conta de origem dos resgates de investimentos do Bradesco.
BRADESCO_INVESTIMENTOS_FF3_ACCT_NAME="Bradesco - Investimentos"

# Identificação da conta Avenue no CSV Wise e seu nome no Firefly III.
AVENUE_ACCT_NO="numero-da-conta"
AVENUE_FF3_ACCT_NAME="Avenue - Investimentos"

# Remetente do Pix recebido no Wise e sua conta de origem no Firefly III.
WISE_REMETENTE_PIX="NOME DO REMETENTE"
WISE_REMETENTE_PIX_FF3_ACCT_NAME="Bradesco"
```

As contas em moedas diferentes do Wise devem seguir o padrão:

```text
<WISE_FF3_ACCT_PREFIX> - <MOEDA>
```

Por exemplo: `Wise - BRL`, `Wise - USD` e `Wise - EUR`.

## Instalação e uso

### Docker Compose

Depois de criar e configurar o `.env`, inicie o importador com:

```sh
docker compose up -d
```

As pastas locais `watch` e `parsed` ficam montadas no contêiner, portanto os
extratos permanecem no host mesmo quando o contêiner for recriado. Para
acompanhar o processamento, use:

```sh
docker compose logs -f
```

Se o Firefly III estiver rodando diretamente na mesma máquina (fora do
Docker), configure no `.env`:

```env
FIREFLY_URL=http://host.docker.internal:8080
```

O nome `localhost` dentro do contêiner aponta para o próprio importador, não
para a máquina host.

### Execução local

Instale as dependências:

```sh
npm install
```

Inicie o importador:

```sh
npm start
```

Com o processo em execução, coloque os extratos na pasta `watch`. Arquivos que já estavam nela também são detectados na inicialização. O programa aguarda a gravação terminar, enfileira os formatos permitidos e os processa sequencialmente.

Os arquivos concluídos são movidos para `parsed`. Arquivos CSV cujo formato não seja reconhecido permanecem em `watch`.

### Envio por HTTP e Apple Shortcuts (Atalhos)

Configure `UPLOAD_TOKEN` no `.env` com um segredo próprio para os uploads. Você
pode gerar um com `openssl rand -hex 32`. O servidor Express inicia junto com o
monitor depois que a conexão com o Firefly III é validada. Sem `UPLOAD_TOKEN`,
apenas o monitor da pasta funciona.

`HTTP_PORT` define a porta interna do Express e a porta na execução local.
`HTTP_HOST_PORT` define a porta publicada pelo Docker. Por exemplo,
`HTTP_PORT=3000` e `HTTP_HOST_PORT=8081` disponibilizam
`http://IP-DO-HOST:8081/upload`. Recrie o serviço depois de alterar o `.env`:
`docker compose up -d`. Para construir localmente esta versão, use
`docker compose up -d --build`.

Para conferir pelo navegador se o servidor HTTP está respondendo, abra
`http://IP-DO-HOST:8081/health` usando sua porta externa. O endpoint `GET /health`
não exige autenticação e retorna HTTP **200** com `{"status":"ok"}`.
Essa resposta confirma a disponibilidade do HTTP; não verifica a conexão atual
com o Firefly III nem o resultado das importações.

O endpoint aceita **um arquivo CSV, OFX ou ZIP por requisição**, de até **25 MiB**,
com o header `Authorization: Bearer SEU_UPLOAD_TOKEN`. Use HTTPS quando acessar
pela internet, para proteger o token e o extrato durante o envio.

No aplicativo **Atalhos** do iOS:

1. Use **Selecionar Arquivo** ou receba o arquivo pela folha de compartilhamento.
2. Adicione **Obter Conteúdo de URL** com a URL `http://IP-DO-HOST:8081/upload`
   (substitua pela sua URL e porta externa).
3. Selecione o método **POST** e adicione o header **Authorization**, com valor
   `Bearer SEU_UPLOAD_TOKEN`.
4. Em **Corpo da Solicitação**, escolha **Formulário**. Adicione um campo do tipo
   **Arquivo**, com a chave **file**, e selecione o arquivo da etapa anterior.
   Deixe o Atalhos definir o `Content-Type` e o boundary do formulário.
5. Opcionalmente, use **Mostrar Resultado** para exibir o JSON retornado.

Também é possível escolher **Arquivo** como corpo da solicitação. Nesse caso,
envie o arquivo diretamente, acrescente o header `X-File-Name` com o nome e a
extensão (por exemplo, `extrato.ofx`) e use `Content-Type: application/octet-stream`.
O suporte do Atalhos a corpos Formulário e Arquivo está descrito na
[documentação da Apple](https://support.apple.com/guide/shortcuts/apd58d46713f/ios).
Para vários arquivos, use **Repetir com Cada Item** e faça um POST por arquivo.

Exemplo com formulário:

```sh
curl --fail-with-body http://localhost:3000/upload \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -F 'file=@/caminho/extrato.ofx'
```

Exemplo com arquivo direto:

```sh
curl --fail-with-body http://localhost:3000/upload \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-File-Name: extratos.zip' \
  --data-binary @/caminho/extratos.zip
```

Nos exemplos, `$UPLOAD_TOKEN` deve estar exportado no shell; o `curl` não lê o
`.env` automaticamente.

Uma resposta **202** confirma que o arquivo foi salvo em `watch`, com nome único
para evitar sobrescritas. Ela **não confirma a importação no Firefly III**: o
monitor processa o arquivo pela mesma fila e pelos mesmos parsers dos arquivos
copiados manualmente, inclusive na extração de ZIPs e no arquivamento em `parsed`.
O arquivo só fica disponível para processamento depois de gravado por completo.
Acompanhe o resultado pelos logs do importador.

```json
{"status":"accepted","filename":"uuid-extrato.ofx"}
```

Erros retornam JSON com `error`: **401** para token ausente ou inválido, **400**
para arquivo vazio ou upload inválido, **413** para tamanho acima do limite e
**415** para extensão não suportada ou codificação de corpo não suportada.

## Prevenção de duplicidade

Antes de importar uma transação OFX ou Wise, o programa pesquisa no endpoint de busca do Firefly III por uma correspondência exata de `internal_reference`. Se ela já existir, a transação é ignorada.

Além disso, todos os envios usam:

```json
{
    "error_if_duplicate_hash": true,
    "apply_rules": true
}
```

Assim, as regras configuradas na interface do Firefly III são executadas durante a importação.

## Scripts disponíveis

```sh
npm start        # inicia o monitor e o HTTP quando UPLOAD_TOKEN está configurado
npm test         # verifica o recebimento de uploads por HTTP
npm run check    # verifica formatação e lint com Biome
npm run format   # formata os arquivos
npm run lint     # executa apenas o lint
npm run biome    # aplica correções sugeridas pelo Biome
npm run check:write
```

## Estrutura do projeto

```text
src/
├── index.js                  # inicia o monitor e o servidor HTTP
├── config.js                 # pasta observada e extensões aceitas
├── filetypes/
│   ├── csv.js                # identifica e encaminha os CSVs
│   ├── csvBradesco.js        # interpreta CSVs do Bradesco
│   ├── csvWise.js            # importa CSVs do Wise
│   ├── ofx.js                # interpreta e importa OFX
│   └── zip.js                # extrai e arquiva ZIPs
└── services/
    ├── files.js              # roteamento e fila de arquivos
    ├── firefly.js            # comunicação com a API do Firefly III
    ├── helpers.js            # conversão e validação de valores e datas
    └── upload.js             # POST autenticado para salvar arquivos em watch

watch/                        # entrada de arquivos
parsed/                       # arquivos já processados
```

## Observações

- O processamento é intencionalmente sequencial para evitar vários envios simultâneos.
- Não remova os arquivos `.gitignore` de `watch` e `parsed`; eles mantêm as pastas no repositório sem versionar extratos bancários.
- Para o envio de Pix do Bradesco ao Wise, ainda é necessário configurar uma regra no Firefly III para excluir ou ajustar a transação correspondente importada pelo OFX do Bradesco.
- O projeto pressupõe o layout atual dos arquivos exportados pelo Wise e pelo Bradesco. Mudanças nas colunas ou na estrutura desses arquivos podem exigir ajustes nos parsers.
