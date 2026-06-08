const { ActivityType, Events } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute: async function(client) {
        console.log(`[Minecon] Ligado como ${client.user.tag}`);

        const statuses = [
            { name: 'CUSTOM', state: 'Powered by CreatorDev', type: ActivityType.Custom },
            { name: 'CUSTOM', state: 'Minecon on Top!', type: ActivityType.Custom },
            { name: 'CUSTOM', state: '/painel', type: ActivityType.Custom },
        ];

        const updateStatus = () => {
            const i = Math.floor(Math.random() * statuses.length);
            client.user.setPresence({
                activities: [statuses[i]],
                status: 'dnd',
            });
        };

        updateStatus();
        // Evita rate limits do Discord (presence updates frequentes)
        setInterval(updateStatus, 30000);
    }
};
