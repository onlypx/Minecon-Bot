module.exports = {
  staffRoleId: process.env.TICKET_STAFF_ROLE_ID || null,
  categoryId: process.env.TICKET_CATEGORY_ID || null,
  transcriptLogChannelId: process.env.TICKET_TRANSCRIPT_LOG_CHANNEL_ID || null,
  panelAccent: 0x111827,
  ticketTypes: {
    parceria: {
      label: 'Parceria',
      emoji: { id: '1444738709135032481', name: 'parceria' },
      emojiText: '<:parceria:1444738709135032481>',
      description: 'Abrir um ticket para propostas de parceria',
      channelPrefix: 'parceria'
    },
    recrutamento: {
      label: 'Recrutamento',
      emoji: { id: '1414736824991088720', name: 'recrutamento' },
      emojiText: '<:recrutamento:1414736824991088720>',
      description: 'Abrir um ticket para recrutamento ou aplicação',
      channelPrefix: 'recrutamento'
    }
  }
};
