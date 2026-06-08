## Integração de proxy residencial (Mineflayer)

Este projeto já suporta proxy **somente** para a conexão Minecraft via `services/minecraft.js` + `proxyManager.js`.

### 1) Configure `proxies.txt`

Um proxy por linha:

```text
socks5://usuario:senha@ip:porta
http://usuario:senha@ip:porta
https://usuario:senha@ip:porta
```

Sem prefixo, o protocolo padrão é `MC_PROXY_PROTOCOL`.

### 2) Habilite no `.env`

```env
MC_PROXY_ENABLED=1
MC_PROXIES_FILE=proxies.txt
MC_PROXY_PROTOCOL=socks5
MC_PROXY_TRIES_PER_TARGET=3
MC_PROXY_CONNECT_TIMEOUT_MS=20000
```

### 3) Rode normalmente

```bash
npm start
```

Logs relevantes:
- `[PROXY]` carregamento/rotação
- `[CONNECT]` tentativas de conexão (target + proxy)
- `[ERROR]` erros de proxy/handshake/timeout
- `[RECONNECT]` rotações e falhas

