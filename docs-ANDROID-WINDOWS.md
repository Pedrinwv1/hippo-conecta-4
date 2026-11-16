# Empacotamento Windows e Android — HIPPO CONECTA 4.0

## Windows (Electron)

Pré-requisitos: Windows 10/11 64-bit, Node.js 20 LTS recomendado e npm.

```powershell
npm.cmd install
Copy-Item .env.example .env
# Edite .env: JWT_SECRET com 32+ caracteres; para empacotamento local mantenha NODE_ENV=development.
npm.cmd run check
npm.cmd test
npm.cmd run desktop:dev
npm.cmd run desktop:dist
```

O instalador NSIS será criado em `release/`. O instalador ainda precisa ser testado em Windows limpo e assinado digitalmente antes de distribuição pública. O servidor local é iniciado dentro do processo Electron e a janela usa `contextIsolation`, `sandbox` e `nodeIntegration=false`.

## Android (Capacitor)

Pré-requisitos: Node.js, Android Studio, Android SDK, JDK 17 e backend HTTPS acessível pela internet.

1. Edite `public/index.html`: no meta `hippo-api-base`, informe a URL HTTPS do backend, sem barra final (ex.: `https://api.seudominio.com`). Essa URL também hospeda o endpoint Socket.IO. No backend, inclua `https://localhost` em `CORS_ORIGINS` para permitir as requisições originadas do app Android, além do domínio web quando houver.
2. Execute:

```powershell
npm.cmd install
npx.cmd cap add android
npm.cmd run android:sync
npm.cmd run android:open
```

3. No Android Studio, aguarde o Gradle Sync. Para APK debug:

```powershell
npm.cmd run android:build:debug
```

4. Para release, configure assinatura em `android/app/build.gradle`/`gradle.properties` usando secrets fora do repositório e execute `npm.cmd run android:build:release`.

O APK não contém o backend. Ele exige API, Socket.IO, HTTPS, TURN e, se habilitada, SFU acessíveis externamente. Não coloque `LIVEKIT_API_SECRET`, `TURN_SHARED_SECRET` ou `JWT_SECRET` dentro do APK.

## Limites do empacotamento

- `android/` é gerado por `cap add android` porque inclui arquivos nativos e wrapper Gradle específicos da instalação Android SDK; não foi possível gerar/validar APK neste ambiente sem Android SDK/Gradle instalado.
- O instalador EXE só pode ser validado no Windows. Não declare build concluído até executar os comandos acima num ambiente Windows com dependências instaladas.

Após `cap add android`, mescle as permissões de `android-template/app/src/main/AndroidManifest.permissions.xml` ao manifesto gerado. A permissão em tempo de execução e o comportamento de `getUserMedia` devem ser testados em aparelhos reais; a mera declaração no manifesto não comprova que câmera/microfone funcionarão em todas as versões Android.
