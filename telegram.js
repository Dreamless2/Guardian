import { existsSync, readFileSync } from 'fs'

function loadEnv(path = './.env') {
    if (!existsSync(path)) return
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const separator = trimmed.indexOf('=')
        if (separator === -1) continue
        const key = trimmed.slice(0, separator).trim()
        let value = trimmed.slice(separator + 1).trim()
        value = value.replace(/^['"]|['"]$/g, '')
        if (key && process.env[key] === undefined) process.env[key] = value
    }
}
loadEnv()

const telegramConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.CHAT_ID,
}

function telegramEnabled() {
    return Boolean(
        telegramConfig.botToken &&
        telegramConfig.chatId &&
        !telegramConfig.botToken.includes('your_telegram_bot_token_here') &&
        !telegramConfig.chatId.includes('your_chat_id_here')
    )
}

async function callTelegramBot(method, body) {
    if (!telegramEnabled()) throw new Error('Telegram não configurado')

    const res = await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })

    const response = await res.json().catch(() => null)

    if (!res.ok || !response?.ok) {
        const description = response?.description || `${res.status} ${res.statusText}`
        throw new Error(`Failed: ${description}`)
    }

    return response.result
}

export async function sendTelegramText(text) {
    if (!telegramEnabled()) return
    await callTelegramBot('sendMessage', {
        chat_id: telegramConfig.chatId,
        text
    })
}


export { telegramEnabled }