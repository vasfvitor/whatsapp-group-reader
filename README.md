# WhatsApp Group Reader

Aplicação local que coleta texto de grupos e contatos explicitamente selecionados e exporta em JSONL ou em texto compacto para uso em LLMs. Não envia mensagens, reações, presença nem confirmações de leitura, e não baixa mídia.

> `whatsapp-web.js` é um cliente não oficial que controla o WhatsApp Web. O projeto se limita a operações de leitura, mas não pode garantir o comportamento interno do serviço nem eliminar o risco de bloqueio da conta.

## Por que whatsapp-web.js

Baileys e whatsmeow reimplementam o protocolo multi-device e falam com o servidor por conexão própria. O `whatsapp-web.js` automatiza o WhatsApp Web oficial dentro de um navegador real, então o que o serviço enxerga é o cliente oficial em uso. A aposta é que isso reduz o risco de bloqueio. Não dá para verificar (o WhatsApp não documenta como detecta automação), mas é a escolha conservadora: nada de protocolo de engenharia reversa para manter, e o comportamento fica colado ao cliente oficial. O custo é depender de um navegador, no caso o Microsoft Edge já instalado na máquina.

## Requisitos

- Windows 10/11 (com Microsoft Edge) ou macOS recente.
- Node.js 24 ou superior.
- pnpm via Corepack.
- Um telefone com WhatsApp para a vinculação.

## Instalação

```sh
corepack enable
pnpm install
pnpm dev
```

O navegador abre em `http://127.0.0.1:5173`. Escaneie o QR se ele aparecer, marque as conversas autorizadas e salve.

Para simular o build de distribuição: `pnpm build` seguido de `pnpm start` (abre em `http://127.0.0.1:3210`).

## Uso

1. Conecte pelo QR exibido na interface.
2. Atualize a lista, marque somente as conversas autorizadas e salve. Nada é sincronizado automaticamente — nem ao conectar, nem ao salvar.
3. Configure a janela (por exemplo, últimas 24 horas e no máximo 500 mensagens por conversa) e o ritmo **Conservador** (padrão) ou **Balanceado**.
4. Clique em **Sincronizar agora** e depois em **Exportar para LLM** (texto compacto) ou **Baixar JSONL completo**.

Remover um chat da seleção interrompe novas coletas, mas não apaga o que já foi salvo. O SQLite, a sessão e as exportações ficam no diretório de dados do usuário; a interface mostra o caminho e oferece **Abrir pasta de dados**.

## Dados exportados

Cada linha do JSONL é um objeto independente:

```json
{
  "chatId": "120000000000000000@g.us",
  "chatName": "Equipe Projeto",
  "chatType": "group",
  "messageId": "true_...",
  "author": "Maria",
  "timestamp": "2026-07-13T18:00:00.000Z",
  "text": "Mensagem de exemplo"
}
```

A exportação para LLM gera os mesmos dados em texto compacto, com cabeçalho de contexto e marcadores por conversa. Mídias sem legenda, chamadas, reações, enquetes, status, canais e mensagens de sistema são ignorados; de mídia com legenda, só o texto da legenda é mantido.

## Controle de carga

A sincronização processa um chat por vez, ampliando a busca em blocos de 50 mensagens, com intervalos randômicos entre blocos e chats e pausas maiores após pequenos lotes. Chats consultados recentemente entram em cooldown; **Forçar nova consulta** ignora o cooldown após confirmação, mas mantém os intervalos. Falhas de leitura usam no máximo duas novas tentativas com backoff exponencial; a reconexão também, de cerca de 2 s até 60 s. Filas podem ser pausadas, retomadas ou canceladas sem perder dados já coletados.

O painel de diagnóstico mantém em memória apenas os 200 eventos operacionais mais recentes e nunca registra o texto das mensagens. Esse controle reduz rajadas locais, mas não simula uma pessoa nem elimina o risco do cliente não oficial.

## Sessão

A sessão usa `LocalAuth` e persiste entre reinicializações. Se for invalidada ou removida pelo telefone, a interface pede confirmação antes de apagar os arquivos locais e gerar outro QR.

## Distribuição (Windows)

`pnpm package:win` gera um zip portátil (~50 MB) em `release/`, com Node embutido e sem navegador embarcado: o app usa o Edge da máquina. Quem recebe o pacote extrai o zip, inicia com `Iniciar.cmd` e encerra com a tecla **F** na janela; se algo travar, `Parar.cmd`. Instruções para o usuário final em `packaging/README-CLIENTE.txt`.

## Scripts

```sh
pnpm dev          # Vite + servidor TypeScript
pnpm build        # typecheck + frontend + backend
pnpm start        # executa o build local
pnpm test         # testes automatizados
pnpm lint:check   # valida lint sem reescrever arquivos
pnpm package:win  # pacote portátil para Windows
```

`dev` e `build` aplicam automaticamente `scripts/patch-wwebjs.mjs`, que corrige o erro `"r"` no `getChats` enquanto a correção upstream não é lançada.

## Arquitetura

- `src/features`: UI e controladores Vue por domínio (conexão, seleção, sincronização, mensagens, diagnóstico, exportação).
- `shared/contracts`: schemas e tipos de transporte por domínio.
- `server/http`: adapters HTTP, sem regra de negócio.
- `server/chats`, `server/messages`, `server/sync`, `server/diagnostics`: serviços e repositórios por capacidade.
- `server/infrastructure`: conexão e schema SQLite (`node:sqlite`, sem dependência nativa).

## Limitações do POC

- Um telefone e uma sessão por máquina.
- Sem integração direta com LLM; a exportação gera texto para colar manualmente.
- Sem nuvem, servidor público ou autenticação multiusuário.
- `fetchMessages()` aceita limite, mas não data inicial; o limite cresce gradualmente e o corte temporal é aplicado localmente.
- O pacing controla o intervalo entre chamadas `fetchMessages()`, não as operações internas do próprio `whatsapp-web.js`.

## Licença

[MIT](LICENSE)
