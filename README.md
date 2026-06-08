# Mush Bed Wars Bot

Bot de Discord + Minecraft para exibir estatísticas de Bed Wars do servidor [Mush.com.br](https://mush.com.br).

## Funcionalidades

- `/bedwars <jogador>` - Exibe estatísticas detalhadas de Bed Wars
- Relay automático Discord -> Minecraft no canal configurado em `IN_GAME_CHANNEL_ID`
- Bot Minecraft conectado 24/7 no clan
- **Logs de clan** (entrada, saída, expulsão, convite)
- Detecção de jogadores nicked
- Cache de 60 segundos para evitar bloqueios
- Rate limiting (1 requisição por segundo)

## Instalação

1. **Clone ou baixe este repositório**

2. **Instale as dependências:**
```bash
npm install
```

3. **Configure o arquivo `.env`:**
```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações.

## Configuração do .env

```env
# === Discord ===
DISCORD_TOKEN=seu_token_aqui
PREFIX=!
GUILD_ID=123456789012345678

# Canal para logs do clan (entrada, saída, expulsão)
CLAN_LOGS_CHANNEL_ID=123456789012345678

# === Minecraft (Microsoft account) ===
MC_EMAIL=seu_email@gmail.com
MC_HOST=mush.com.br
MC_PORT=25565

# (Opcional) Conexão simples (somente conectar e logar spawn)
MC_SIMPLE=0

# (Opcional) Ignorar SRV e usar apenas host/porta acima
MC_DISABLE_SRV=1

# (Opcional) Hosts alternativos (mesma porta)
MC_FALLBACK_HOSTS=

# (Opcional) Lista explícita de alvos host:porta (prioriza estes alvos; por padrão ainda tenta SRV/fallbacks)
MC_TARGETS=

# (Opcional) Se 1, usa somente MC_TARGETS (não tenta SRV/fallbacks/hardcoded)
MC_TARGETS_ONLY=0

# (Opcional) Timeouts
MC_CONNECT_TIMEOUT_MS=20000
MC_PROBE_TIMEOUT_MS=3000

# (Opcional) Evitar alvos "mortos": se um target falhar N vezes seguidas, entra em cooldown
MC_BAD_TARGET_FAILS_BEFORE_COOLDOWN=2
MC_BAD_TARGET_COOLDOWN_MS=600000

# (Opcional) Logs extras de diagnóstico
MC_DEBUG=0

# === API (não mexer) ===
MUSH_API_URL=https://mush.com.br/api
CACHE_TTL=60
RATE_LIMIT_MS=1000
```

## Obtendo o Token do Discord

1. Acesse [Discord Developer Portal](https://discord.com/developers/applications)
2. Clique em "New Application" e nomeie seu bot
3. Vá em "Bot" e clique em "Reset Token" para obter o token
4. Em "Privileged Gateway Intents", habilite:
   - GUILD_MESSAGES
   - MESSAGE_CONTENT
5. Em "OAuth2", gere um invite URL com `bot` e `applications.commands`

## Sistema de Logs do Clan

O bot monitora o chat do servidor e detecta eventos de clan:

| Evento | Cor Embed | Emoji |
|--------|-----------|-------|
| Entrada no clan | Verde | 🟢 |
| Saída do clan | Laranja | 🔴 |
| Expulso do clan | Vermelho | ⛔ |
| Convite enviado | Azul | 📩 |

Configure o canal de logs no `.env` com `CLAN_LOGS_CHANNEL_ID`.

## Comandos

### Discord (Slash Commands)
- `/bedwars <jogador>` - Busca stats de Bed Wars

### Discord (Prefixo)
- `!bedwars <jogador>` - Busca stats
- `!status` - Verifica status do bot

### Minecraft (In-Game)
- `!bedwars <jogador>` - Busca stats
- `!status` - Verifica status

## Estrutura do Projeto

```
mush-bedwars-bot/
├── .env.example       # Exemplo de configuração
├── index.js           # Entrada (chama o manager)
├── manager/           # Supervisor/healthcheck/restart
├── discord/           # Worker do Discord
├── minecraft/         # Worker do Mineflayer
├── package.json       # Dependências
├── README.md          # Este arquivo
├── commands/         # Comandos do bot
│   ├── bedwars.js
├── services/         # Serviços externos
│   ├── api.js        # API do Mush.com.br
│   └── minecraft.js  # Bot Minecraft (Mineflayer)
└── utils/            # Utilitários
    └── formatters.js # Formatadores (Discord embeds + Minecraft)
```

## Executando o Bot

```bash
npm start
```

## Arquitetura 24h (processos separados)

O bot roda em 3 processos:

```text
Discord Worker   -> discord/bot.js
Manager          -> manager/index.js
Minecraft Worker -> minecraft/worker.js
```

O `manager/index.js`:

- expõe um health check HTTP (`PORT`, padrão `3000`, com fallback pra porta aleatória se estiver ocupada)
- reinicia workers quando crasharem
- aplica reconexão inteligente (backoff/cooldown) pro Minecraft

O `minecraft/worker.js` (watchdog):

- encerra o processo quando detectar freeze/alto uso de RAM (o manager reinicia)
- variáveis:
  - `MC_MAX_RSS_MB` (default `380`)
  - `MC_FREEZE_MS` (default `180000`)

## Proxy residencial (SOCKS5/HTTP/HTTPS)

1) Coloque seus proxies em `proxies.txt` (formato `usuario:senha@ip:porta`). Você também pode prefixar com `socks5://`, `http://` ou `https://`.

2) Ative no `.env`:

```env
MC_PROXY_ENABLED=1
MC_PROXIES_FILE=proxies.txt
MC_PROXY_PROTOCOL=socks5
```

O proxy é usado **somente** na conexão Minecraft (Mineflayer). Logs saem com tags `[PROXY]`, `[CONNECT]`, `[ERROR]`, `[RECONNECT]`.

O botirá:
1. Conectar no Discord
2. Conectar no servidor Minecraft (se configurado)
3. Registrar comandos slash

## Solução de Problemas

### "TOKEN não configurado"
- Verifique se o arquivo `.env` existe e contém `DISCORD_TOKEN`

### "Falha ao conectar bot Minecraft"
- Verifique o username
- Verifique se a conta não está banida no servidor
- Tente fazer login manualmente primeiro

### "API indisponível"

- A API do Mush pode estar offline temporariamente
- Verifique sua conexão com a internet

### "Jogador não encontrado"
- O jogador pode não existir no servidor
- Ou pode estar com nome diferente no jogo

### Exemplos

<img width="689" height="100" alt="image" src="https://github.com/user-attachments/assets/edcbb2e8-45a2-4a12-bec5-5896cc132cc9" />

