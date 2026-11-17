# HIPPO CONECTA 4.0 — código-fonte

Evolução técnica do projeto 3.2.0_LOGO. Versão atual do pacote: 4.0.0-rc.2. A identidade visual e os assets de marca foram preservados.

## Requisitos
- Node.js 20 LTS recomendado (mínimo 18) e npm.
- Windows: Windows 10/11 x64 para gerar/testar instalador.
- Android: Android Studio, SDK, JDK 17 e backend HTTPS público.

## Publicação online gratuita

Consulte `docs-DEPLOY-GRATUITO.md` e o blueprint `render.yaml`. A arquitetura de piloto usa Render Free + Supabase PostgreSQL + Cloudflare R2. Em hospedagem com disco efêmero, configure R2 para preservar avatares e anexos.

## Instalação e execução web/backend

```powershell
npm.cmd install
Copy-Item .env.example .env
# Edite JWT_SECRET com segredo aleatório de 32+ caracteres.
npm.cmd run check
npm.cmd test
npm.cmd start
```
Acesse `http://localhost:3000`.

## Empacotamento
- Windows Electron/NSIS: `npm run desktop:dev` e `npm run desktop:dist`.
- Android Capacitor: consulte `docs-ANDROID-WINDOWS.md`. Gere o projeto nativo com `npx cap add android`, sincronize e compile no Android Studio/Gradle.

## Chamadas
- WebRTC P2P com sinalização Socket.IO e reconexão/ICE restart.
- STUN padrão público; TURN real requer coturn e segredos em `.env`.
- Endpoint de token SFU LiveKit e compose de referência preparados. O cliente ainda não foi migrado de P2P para SFU; veja `docs-CHAMADAS.md`.

## PostgreSQL
Schema e importador de dados JSON incluídos. O armazenamento em runtime continua JSON até a refatoração assíncrona do repositório; veja `docs-POSTGRES.md`. A importação não apaga nem altera o JSON original.

## Segurança
Leia `SECURITY_AUDIT.md`. A auditoria é estática, não é pentest. Não publique sem HTTPS, segredos fortes, TURN, backup, validação de uploads e testes externos.

## Estado honesto da entrega

Implementado no código-fonte: configuração Electron, preload isolado, electron-builder NSIS, Capacitor config, Tailwind fixado em 3.4.17, endpoint de credenciais LiveKit, templates SFU, importador PostgreSQL, schema, auditoria e teste automatizado básico.

Dependente de ambiente/serviço: instalar dependências npm, gerar `android/` via Capacitor/Android SDK, gerar EXE em Windows, gerar APK no Android Studio, configurar TURN/LiveKit/PostgreSQL e executar testes reais em dispositivos/redes externas.

Ainda pendente para lançamento: integração do cliente de mídia com SFU (a topologia ativa continua Mesh P2P), instalação e teste dos serviços externos TURN/LiveKit/PostgreSQL, geração e validação do APK/EXE em seus ambientes-alvo, testes multiusuário em redes distintas, pentest e revisão operacional.

## HIPPO CONECTA 5.4.0

- Android: WebView initialization stabilized, API/Socket.IO endpoint initialized explicitly, viewport safe areas and keyboard resizing configured.
- Notifications: message alerts respect the user's saved preference; browser/system notifications are requested only after user action, with in-app alerts as fallback.
- Android build: launcher assets, camera/microphone/internet and notification permissions are configured in the generated manifest.
- The Windows desktop installer remains available in the same release.

Note: push delivery while the Android app is fully closed still requires Firebase Cloud Messaging credentials and a configured Firebase project. The current implementation covers in-app alerts and supported browser notifications while the app session is active.

Build de distribuição 5.4.0 validado no GitHub Actions; a publicação utiliza os artefatos APK e EXE já compilados e verificados.
Publicação 5.4.0: artefatos previamente validados com permissão de leitura do GitHub Actions habilitada para o job de release.
