import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from 'baileys'
import qrcode from 'qrcode-terminal'
import { sendTelegramText, telegramEnabled } from './telegram.js'
import express from 'express'

const app = express();
const PORT = process.env.PORT || 9090;

app.get('/', (req, res) => {
    res.send('OK');
});

app.listen(PORT, () => {
    console.log(`Server executing On port ${PORT}`);
});

const MSG = `BEM VINDO, {user}, AO "PAPO RETO GUITARS" (Cleiton Feijó)

🚨 IMPORTANTE: LEIA A DESCRIÇÃO E AS REGRAS DO GRUPO! 🚨

🚨 QUEM NÃO LÊ A *DESCRIÇÃO* NÃO SE IMPORTA COM AS *REGRAS*. É OBRIGAÇÃO DE CADA MEMBRO LER E ENTENDER O REGIMENTO. SUJEITO A *EXCLUSÃO IMEDIATA*, CASO FAÇA ALGO FORA DAS NORMAS. A EXCLUSÃO SERÁ SEM AVISO PRÉVIO! 🚨

QUALQUER DÚVIDA, ACIONAR OS ADMINISTRADORES DO GRUPO: `

const TARGETS = [
    '120363424263007033@g.us',
]

const RATE_LIMIT = 12000
const cache = new Map()

const wait = (ms) => new Promise(r => setTimeout(r, ms))
const jitter = () => wait(Math.floor(Math.random() * 2500) + 1500)
const formatError = (err) => err?.stack || err?.message || String(err)

async function notifyTelegramEvent(title, details = '') {
    if (!telegramEnabled()) return
    try {
        const text = details
            ? `[${title}]\nTime: ${new Date().toISOString()}\n${details}`
            : `[${title}]\nTime: ${new Date().toISOString()}`
        await sendTelegramText(text)
    } catch (err) {
        console.log(`[Telegram] Failed to send ${title}: ${err.message}`)
    }
}

async function main() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: ['Ubuntu', 'Chrome', '22.04.4'],
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`
            console.log('--- New QR CODE ---')
            console.log(qrUrl)
            qrcode.generate(qr, { small: true })
            void notifyTelegramEvent('QR CODE', qrUrl)
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            console.log(`Connection closed. Reconnecting: ${shouldReconnect}`)
            void notifyTelegramEvent('DISCONNECTED', [
                `Status code: ${statusCode || 'unknown'}`,
                `Reconnect: ${shouldReconnect}`,
                `Error: ${formatError(lastDisconnect?.error || 'unknown')}`,
            ].join('\n'))

            if (shouldReconnect) {
                await wait(5000)
                main()
            } else {
                console.log('[auth] session expired')
                void notifyTelegramEvent('SESSION EXPIRED')
            }
        }

        if (connection === 'open') {
            const id = sock.user.id.split(':')[0]
            console.log(`Connected as ${id}`)
            void notifyTelegramEvent('ONLINE', `Number: ${id}`)
        }
    })

    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id, participants, action } = update

            if (!id.endsWith('@g.us')) return
            if (!TARGETS.includes(id)) return

            const self = sock.user.id.split(':')[0]

            let groupName = 'unknown'
            try {
                const meta = await sock.groupMetadata(id)
                groupName = meta.subject || 'unknown'
            } catch (err) {
                console.log(`[ERROR] Failed to fetch group metadata for ${id}: ${err.message}`)
                groupName = 'unknown'
            }

            for (const p of participants) {
                let jid = typeof p === 'string' ? p : p.id || p
                let phoneNumber = null

                if (typeof p === 'object' && p !== null) {
                    if (p.phoneNumber) phoneNumber = p.phoneNumber.split('@')[0]
                }

                if (jid.endsWith('@lid')) {
                    if (!phoneNumber) {
                        try {
                            const meta = await sock.groupMetadata(id)
                            const participantMeta = meta.participants.find(m => m.id === jid || m.lid === jid)
                            if (participantMeta && participantMeta.id && !participantMeta.id.endsWith('@lid')) {
                                phoneNumber = participantMeta.id.split('@')[0]
                            }
                        } catch (_) { }
                    }
                } else {
                    phoneNumber = jid.split('@')[0]
                }

                const user = phoneNumber || jid.split('@')[0]

                if (jid.includes(self) || (phoneNumber && phoneNumber.includes(self))) continue

                if (action === 'add') {
                    const now = Date.now()
                    if (now - (cache.get(id) || 0) < RATE_LIMIT) return
                    cache.set(id, now)

                    await jitter()

                    const text = MSG.replace('{user}', user)
                    await sock.sendMessage(id, {
                        text,
                        mentions: [jid]
                    })

                    console.log(`[JOIN] ${user} (${jid})`)
                    void notifyTelegramEvent('JOIN', [
                        `User: ${user}`,
                        `JID: ${jid}`,
                        `Group: ${id}`,
                        `Group Name: ${groupName}`,
                    ].join('\n'))
                }

                if (action === 'remove') {
                    console.log(`[LEAVE] ${user} (${jid})`)
                    void notifyTelegramEvent('LEAVE', [
                        `User: ${user}`,
                        `JID: ${jid}`,
                        `Group: ${id}`,
                        `Group Name: ${groupName}`,
                    ].join('\n'))
                }
            }
        } catch (err) {
            console.log(`[ERROR] ${err.message}`)
            void notifyTelegramEvent('ERROR', formatError(err))
        }
    })
}

process.on('unhandledRejection', (err) => {
    console.log(`[Unhandled Rejection] ${formatError(err)}`)
    void notifyTelegramEvent('UNHANDLED REJECTION', formatError(err))
})

process.on('uncaughtException', (err) => {
    console.log(`[Uncaught Exception] ${formatError(err)}`)
    void notifyTelegramEvent('UNCAUGHT EXCEPTION', formatError(err))
})

main()