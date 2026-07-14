# WhatsApp Group Reader

Aplicação local para coletar texto de grupos e contatos explicitamente selecionados e exportar os dados em JSONL. O projeto não envia mensagens, reações, presença, confirmações de leitura ou arquivos e não baixa mídia.

> `whatsapp-web.js` é um cliente não oficial que controla o WhatsApp Web. O projeto reduz a superfície a operações de leitura, mas não pode garantir o comportamento interno do serviço nem eliminar o risco de bloqueio da conta.

## Requisitos

- Windows 10/11 ou macOS recente.
- Node.js 22.12 ou superior (recomendado: Node.js 24 LTS).
- pnpm via Corepack.
- Um telefone com WhatsApp para a vinculação inicial.

## Instalação

No PowerShell do Windows ou Terminal do macOS:

```sh
corepack enable
pnpm install
pnpm dev
```

O navegador abrirá em `http://127.0.0.1:5173`. Escaneie o QR somente se ele aparecer, aguarde a lista de conversas, marque os grupos/contatos permitidos e salve a configuração.

Para simular o build de distribuição local:

```sh
pnpm build
pnpm start
```

Nesse modo, a aplicação abre em `http://127.0.0.1:3210`.

## Uso

1. Conecte o WhatsApp pelo QR exibido na interface.
2. Atualize a lista e marque somente as conversas autorizadas.
3. Opcionalmente, associe tags locais ou use regras `exact`, `contains` e `tag` para marcar candidatos.
4. Configure a janela, por exemplo, últimas 24 horas e no máximo 500 mensagens por conversa.
5. Escolha o ritmo **Conservador** ou **Balanceado**.
6. Salve, sincronize e clique em **Baixar JSONL**.

As regras nunca autorizam sozinhas um chat novo: somente os IDs confirmados nos checkboxes formam a allowlist. Tags são rótulos locais e não são enviadas ao WhatsApp.

O SQLite, a sessão e as exportações ficam no diretório de dados do usuário. A interface mostra o caminho e oferece **Abrir pasta de dados**. Remover um chat da seleção interrompe novas coletas, mas não apaga registros anteriores.

## Scripts

```sh
pnpm dev          # Vite + servidor TypeScript
pnpm build        # typecheck + frontend + backend
pnpm start        # executa o build local
pnpm test         # testes automatizados
pnpm test:unit    # testes em modo watch
pnpm lint:check   # valida lint sem reescrever arquivos
```

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

Mídias sem legenda, chamadas, reações, enquetes, status, broadcasts, canais, mensagens de sistema e conteúdo vazio são ignorados. Para mídia com legenda, somente o texto da legenda é preservado.

## Controle de carga

A sincronização histórica processa um chat por vez e amplia a busca em blocos de 50 mensagens. Entre blocos e chats são aplicados intervalos randômicos limitados, com pausas maiores após pequenos lotes. O perfil **Conservador** é o padrão e usa intervalos e cooldowns maiores.

Sincronizações automáticas e manuais ignoram temporariamente chats consultados recentemente. A ação **Forçar nova consulta** permite ignorar esse cooldown após confirmação explícita, mas continua respeitando os intervalos. Filas longas podem ser pausadas, retomadas ou canceladas sem remover dados já coletados. Ao retomar, um novo intervalo completo é aplicado antes da próxima leitura.

Falhas de leitura usam no máximo duas novas tentativas com backoff exponencial e jitter limitado. A reconexão também usa backoff exponencial, partindo de aproximadamente 2 segundos e limitada a 60 segundos. Atualizações simultâneas da lista são agrupadas e, durante uma sincronização, a lista em cache é usada sem uma nova consulta ao WhatsApp.

Durante a coleta, a interface mostra a posição da conversa na fila, quantas mensagens foram analisadas, quantas passaram pelos filtros e quantas eram novas. O painel **Detalhes técnicos para diagnóstico** fica recolhido por padrão e mantém em memória somente os 200 eventos operacionais mais recentes. Ele não registra o texto das mensagens nem mídias e é limpo quando o servidor reinicia.

Esse controle reduz rajadas locais; ele não simula de forma garantida uma pessoa, não contorna regras do WhatsApp e não elimina o risco associado ao cliente não oficial.

## Sessão e reconexão

A sessão usa `LocalAuth` e persiste entre reinicializações. Desconexões transitórias usam tentativas progressivas. Se a sessão for invalidada ou removida pelo telefone, a interface pede confirmação antes de apagar os arquivos locais e gerar outro QR.

## Limitações do POC

- Um telefone e uma sessão por máquina.
- Sem integração com LLM nesta fase.
- Sem Electron, nuvem, servidor público ou autenticação multiusuário.
- `fetchMessages()` aceita limite, mas não uma data inicial; a aplicação amplia o limite gradualmente e aplica o corte temporal localmente.
- O pacing controla o intervalo entre chamadas `fetchMessages()`, mas não controla eventuais operações internas realizadas pelo próprio `whatsapp-web.js` dentro de uma chamada.
