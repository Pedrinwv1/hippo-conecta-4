# HIPPO CONECTA 4.0 — status de release candidate

**Estado: RC técnica; ainda não autorizada para lançamento público.**

## Implementado no código
- Configuração Electron com janela isolada, permissões locais de mídia e captura de tela, servidor vinculado somente a `127.0.0.1` e empacotamento NSIS.
- Configuração Capacitor para Android; o projeto nativo é gerado no ambiente Android com `cap add android`.
- Tailwind CSS 3.4.17 fixado.
- WebRTC Mesh com sinalização autenticada Socket.IO, ICE servers, TURN REST credentials, fila ICE, perfect negotiation, ICE restart e limite de sinalização.
- Endpoint autenticado de token LiveKit (SFU), Docker Compose e configuração de referência. **O frontend continua usando Mesh P2P; SFU não está integrada ao cliente.**
- PostgreSQL em runtime via `DATABASE_URL`, com snapshot JSONB transacional para preservar a estrutura atual; importador do JSON e schema incluídos.
- Testes unitários do armazenamento JSON e verificação de sintaxe.

## Bloqueadores antes do lançamento
1. Integrar o LiveKit Client SDK ao frontend e validar chamadas SFU reais.
2. Provisionar e testar TURN/coturn e LiveKit com domínios, TLS e credenciais reais.
3. Executar migração de dados real num PostgreSQL de homologação, validar contagens, backups e rollback.
4. Gerar e testar APK assinado em aparelhos Android reais.
5. Gerar e testar EXE/NSIS em Windows limpo; assinar o instalador.
6. Testar cadastro/login, mensagens, upload, autorização e chamadas com múltiplos usuários em redes diferentes.
7. Fazer pentest, análise de dependências e revisão de privacidade/termos/backup/monitoramento.

## Verificação desta entrega
- `node --check` nos arquivos JavaScript: executado nesta sessão.
- `npm test`: 2 testes aprovados nesta sessão.
- `npm install`: tentou executar, mas excedeu o limite de tempo disponível; dependências não foram instaladas.
- `npm run check`, build Tailwind, build Electron e build Android: **não executados**, pois as dependências e toolchains não estavam disponíveis.
- Nenhum APK ou EXE foi gerado nesta sessão.

Não publique esta RC como versão final até fechar os bloqueadores e registrar os testes reais.

## Preparação de hospedagem gratuita — RC2
- Blueprint `render.yaml` para Render Free com health check, Node 20 e segredos externos solicitados no provisionamento.
- Backend configurado para reconhecer a origem pública do Render e confiar no proxy reverso para IPs de cliente.
- Adaptador de arquivos compatível com Cloudflare R2; em produção, o blueprint exige R2 para evitar perda de uploads no filesystem efêmero.
- O blueprint exige `DATABASE_URL` e bloqueia fallback acidental para JSON local.
- Testes locais executados nesta sessão: `npm run check` aprovado e `node --test` com 3 testes aprovados.
- Não foi possível gerar `package-lock.json` nem executar instalação/build completos: o registro npm não estava acessível nesta sessão. O Render instalará dependências no deploy, mas é recomendável gerar e versionar lockfile numa máquina com internet antes de abrir o app.
- Nenhum deploy real foi executado; contas e credenciais do usuário ainda precisam ser criadas/configuradas.
