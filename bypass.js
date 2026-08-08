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
            // Trata o objeto p para extrair tanto o jid principal quanto o pn (Phone Number), se disponível
            let jid = typeof p === 'string' ? p : p.id || p
            let phoneNumber = null

            // Se p for um objeto contendo a propriedade `phoneNumber` ou `jid`
            if (typeof p === 'object' && p !== null) {
                if (p.phoneNumber) phoneNumber = p.phoneNumber.split('@')[0]
            }

            // Se for LID e não achamos o phoneNumber no objeto
            if (jid.endsWith('@lid')) {
                // Tenta buscar no cache/metadata do grupo se o objeto contiver a conversão
                if (!phoneNumber) {
                    try {
                        const meta = await sock.groupMetadata(id)
                        const participantMeta = meta.participants.find(m => m.id === jid || m.lid === jid)
                        if (participantMeta && participantMeta.id && !participantMeta.id.endsWith('@lid')) {
                            jid = participantMeta.id
                            phoneNumber = jid.split('@')[0]
                        }
                    } catch (_) {}
                }
            } else {
                phoneNumber = jid.split('@')[0]
            }

            // Fallback caso não consiga resolver o LID para número tradicional
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
                    mentions: [jid] // Mantém a menção no JID correto (seja LID ou s.whatsapp.net)
                })

                console.log(`[JOIN] ${user}`)
                void notifyTelegramEvent('JOIN', [
                    `User: ${user}`,
                    `Group: ${id}`,
                    `Group Name: ${groupName}`,
                ].join('\n'))
            }

            if (action === 'remove') {
                console.log(`[LEAVE] ${user}`)
                void notifyTelegramEvent('LEAVE', [
                    `User: ${user}`,
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