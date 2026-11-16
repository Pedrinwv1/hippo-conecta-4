# Publicação gratuita — HIPPO CONECTA 4.0 RC2

## Arquitetura proposta

- **Render Free:** backend Node.js + Express + Socket.IO e interface estática servida pelo mesmo domínio.
- **Supabase Free:** PostgreSQL gerenciado.
- **Cloudflare R2 Standard:** avatares e anexos, sem depender do disco efêmero do Render.
- **WebRTC atual:** Mesh P2P com STUN público. TURN não está incluído; chamadas podem falhar em redes restritivas. O cliente ainda não usa LiveKit/SFU.

Esta arquitetura serve para homologação e um lançamento pequeno entre amigos. Não oferece SLA, disponibilidade contínua nem capacidade garantida. O Render Free suspende serviços após 15 minutos sem tráfego HTTP ou mensagens WebSocket recebidas; o primeiro acesso pode levar cerca de um minuto. O sistema de arquivos local do Render é efêmero. O Supabase Free pode pausar projetos após uma semana de inatividade e tem limite de banco de 500 MB. O R2 tem franquia mensal de 10 GB-mês, 1 milhão de operações Classe A e 10 milhões Classe B no armazenamento Standard; excedentes podem gerar cobrança. Consulte os limites atuais antes de abrir o cadastro ao público.

## 1. Criar o PostgreSQL no Supabase

1. Crie uma conta em https://supabase.com/ e um projeto Free.
2. Escolha a região mais próxima disponível (São Paulo, se disponível no cadastro).
3. Em **Project Settings → Database → Connection string**, selecione o modo **Session pooler** se o host direto não aceitar IPv4 no Render.
4. Copie a URI PostgreSQL. Não publique nem envie essa URI em chats públicos.
5. No Render, ela será cadastrada como `DATABASE_URL`. O blueprint já define `PGSSL=true`.

O backend cria `hc_state` na primeira inicialização. O blueprint define `REQUIRE_POSTGRES=true`, então o serviço não inicia acidentalmente no JSON efêmero se a variável de conexão ficar vazia. Para começar sem histórico, basta deixar o backend inicializar o banco. Se for importar dados antigos, faça backup do `server/data.json` e execute `npm run db:migrate:postgres` em ambiente seguro antes de apontar o serviço para o banco definitivo.

## 2. Criar o bucket R2

1. Crie uma conta Cloudflare: https://dash.cloudflare.com/.
2. Abra **R2 Object Storage** e crie um bucket Standard chamado, por exemplo, `hippo-conecta-files`.
3. Em **Manage R2 API Tokens**, crie credenciais com permissão Object Read & Write apenas para esse bucket.
4. Copie o endpoint S3 no formato `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
5. Para um piloto pequeno sem domínio próprio, habilite **Public Development URL** e copie a URL `https://....r2.dev`. Ela é limitada e documentada pela Cloudflare como URL de desenvolvimento; para produção pública, use domínio próprio conectado ao bucket.
6. Cadastre no Render: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` e `R2_PUBLIC_URL`.

O bucket público significa que quem tiver o link de um arquivo poderá acessá-lo. Não armazene conteúdo sensível. O backend exige o R2 configurado em produção para evitar perder arquivos no disco temporário.

## 3. Publicar no Render

1. Envie este código para um repositório **privado** no GitHub. Nunca inclua `.env`, senhas, tokens, dumps de banco ou `server/data.json`.
2. Abra https://render.com/ e conecte o GitHub.
3. Escolha **New → Blueprint** e selecione o repositório com `render.yaml`.
4. Confirme a criação do serviço `hippo-conecta` no plano Free.
5. Preencha os campos `DATABASE_URL` e as cinco variáveis `R2_*` solicitadas pelo blueprint. `JWT_SECRET` é gerado pelo Render.
6. Aguarde o deploy e confira `/healthz` no endereço `https://hippo-conecta.onrender.com/healthz` (o subdomínio pode variar se já estiver ocupado).
7. Abra a raiz do domínio e teste cadastro, login, criação de servidor, mensagens, Socket.IO e upload.

O backend e a interface são servidos pelo mesmo domínio; `HIPPO_API_BASE` permanece vazio e o frontend usa `window.location.origin`. Não é necessário criar um projeto Cloudflare Pages separado nesta arquitetura.

## 4. Testes mínimos antes de convidar usuários

- Abrir o domínio em janela anônima e confirmar HTTPS.
- Criar duas contas diferentes em dois dispositivos/rede móvel e Wi-Fi.
- Entrar no mesmo servidor/canal e trocar mensagens nos dois sentidos.
- Enviar avatar e anexo; reiniciar/redeployar o serviço e confirmar que os links continuam válidos.
- Testar chamada entre redes diferentes. A topologia atual é Mesh P2P; sem TURN real, algumas combinações de NAT/firewall não conectarão.
- Reiniciar o serviço e confirmar que contas, servidores e mensagens continuam no PostgreSQL.
- Fazer backup do banco e testar restauração antes de divulgar o app.

## 5. Limitações conhecidas desta publicação

- Render Free pode dormir após 15 minutos sem tráfego e não fornece disco persistente.
- Supabase Free pode pausar por inatividade e não inclui backups automáticos no plano Free.
- O R2 `r2.dev` é endpoint de desenvolvimento, público e sujeito a limitação; não é recomendado para uso público em escala.
- Chamadas continuam WebRTC Mesh; sem TURN não há garantia de conectividade em todas as redes.
- O cliente LiveKit/SFU não está integrado nesta RC.
- Não há monitoramento, SLA, e-mail transacional próprio ou processo de recuperação de conta validado.
- O plano gratuito pode mudar. Acompanhe cotas e configure alertas de uso/faturamento em cada provedor.

## Links oficiais

- Render Free: https://render.com/docs/free
- Supabase Pricing: https://supabase.com/pricing
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 public buckets: https://developers.cloudflare.com/r2/buckets/public-buckets/
