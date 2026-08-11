// Aplica o PR wwebjs/whatsapp-web.js#201850 (não lançado no npm) sobre o
// whatsapp-web.js 1.34.7 instalado: o WhatsApp Web (2.3000.104x, ago/2026)
// renomeou a propriedade `_serialized` das chaves de mensagem para `$1`,
// fazendo Msg.get(undefined) lançar DataError minificado ("r") em getChats().
// Remover quando uma versão do whatsapp-web.js com a correção for publicada.
//
// Uso: node scripts/patch-wwebjs.mjs [caminho/para/node_modules]
//   - sem argumento: node_modules do repositório (dev)
//   - com argumento: usado pelo scripts/package-win.ps1 contra o staging
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const nodeModules = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL('../node_modules', import.meta.url))
const target = path.join(nodeModules, 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js')

if (!existsSync(target)) {
  console.error(`patch-wwebjs: arquivo não encontrado: ${target}`)
  process.exit(1)
}

let content = readFileSync(target, 'utf8')

if (content.includes('getMsgKeyId')) {
  console.log('patch-wwebjs: já aplicado — nada a fazer.')
  process.exit(0)
}

const replacements = [
  {
    name: 'getMessageModel: Msg.get tolera $1',
    from: '.Msg.get(newMsgKey._serialized);',
    to: '.Msg.get(window.WWebJS.getMsgKeyId(newMsgKey));',
  },
  {
    name: 'editMessage: Msg.get tolera $1',
    from: "return window.require('WAWebCollections').Msg.get(msg.id._serialized);",
    to: `return window
            .require('WAWebCollections')
            .Msg.get(window.WWebJS.getMsgKeyId(msg.id));`,
  },
  {
    name: 'serialização: restaura msg.id._serialized',
    from: `        delete msg.pendingAckUpdate;

        return msg;`,
    to: `        // WhatsApp Web renomeou _serialized -> $1 no id serializado; restaurar
        // aqui para que todo consumidor de message.id._serialized continue funcionando.
        if (typeof msg.id === 'object' && msg.id._serialized == null) {
            const serializedId = window.WWebJS.getMsgKeyId(msg.id);
            if (serializedId) {
                msg.id = Object.assign({}, msg.id, {
                    _serialized: serializedId,
                });
            }
        }

        delete msg.pendingAckUpdate;

        return msg;`,
  },
  {
    name: 'helper getMsgKeyId + getChats resiliente por chat',
    from: `    window.WWebJS.getChats = async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        const chatPromises = chats.map((chat) =>
            window.WWebJS.getChatModel(chat),
        );
        return await Promise.all(chatPromises);
    };`,
    to: `    /**
     * Id serializado de uma chave de mensagem, tolerando o rename de
     * \`_serialized\` para \`$1\` feito pelo WhatsApp Web. Retorna undefined
     * quando nenhum existe, para o chamador pular a consulta ao IndexedDB.
     */
    window.WWebJS.getMsgKeyId = (key) =>
        key?._serialized ?? key?.$1 ?? undefined;

    window.WWebJS.getChats = async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();

        // Processa cada chat individualmente — uma falha não descarta os demais
        const results = [];
        for (const chat of chats) {
            try {
                const model = await window.WWebJS.getChatModel(chat);
                if (model) results.push(model);
            } catch {
                // pula chats que falham na serialização (ex.: metadados LID)
            }
        }
        return results;
    };`,
  },
  {
    name: 'getChatModel: groupMetadata.update tolera LID',
    from: '            await groupMetadata.update(chatWid);',
    to: `            try {
                await groupMetadata.update(chatWid);
            } catch {
                // IDs LID podem não existir no IndexedDB — segue sem metadados
                model.groupMetadata = null;
            }`,
  },
  {
    name: 'getChatModel: lastReceivedKey tolera $1',
    from: `            const lastMessage = chat.lastReceivedKey
                ? window
                      .require('WAWebCollections')
                      .Msg.get(chat.lastReceivedKey._serialized) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([
                              chat.lastReceivedKey._serialized,
                          ])
                  )?.messages?.[0]
                : null;`,
    to: `            const lastReceivedKeyId = window.WWebJS.getMsgKeyId(
                chat.lastReceivedKey,
            );
            const lastMessage = lastReceivedKeyId
                ? window
                      .require('WAWebCollections')
                      .Msg.get(lastReceivedKeyId) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([lastReceivedKeyId])
                  )?.messages?.[0]
                : null;`,
  },
]

for (const { name, from, to } of replacements) {
  if (!content.includes(from)) {
    console.error(`patch-wwebjs: trecho esperado não encontrado (${name}).`)
    console.error('A versão instalada do whatsapp-web.js pode ter mudado — revise o patch.')
    process.exit(1)
  }
  content = content.replace(from, to)
}

// unlink antes de gravar: o node_modules do pnpm usa hard links para o store
// global — gravar in-place corromperia a cópia compartilhada entre projetos.
unlinkSync(target)
writeFileSync(target, content, 'utf8')
console.log(`patch-wwebjs: aplicado com sucesso em ${target}`)
