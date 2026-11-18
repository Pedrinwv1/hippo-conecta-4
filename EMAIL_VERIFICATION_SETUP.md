# HIPPO CONECTA 5.7.3 — verificação de e-mail

O cadastro agora exige confirmação do endereço antes de criar a conta.

## Configuração obrigatória do serviço de e-mail

O backend envia códigos por meio da API do Resend. No painel do Render, abra o serviço do HIPPO em **Environment** e configure:

- `RESEND_API_KEY`: chave secreta criada no painel do Resend.
- `EMAIL_FROM`: remetente com domínio verificado no Resend, por exemplo `HIPPO CONECTA <no-reply@seudominio.com>`.

Não coloque a chave no frontend, no GitHub, no APK ou no EXE. Configure-a somente como variável secreta no Render.

Sem essas duas variáveis, o cadastro falha de forma fechada (não cria conta sem verificar e-mail). O login de contas já existentes continua funcionando.

## Proteções

- Código aleatório de 6 dígitos.
- Expiração em 10 minutos.
- Até 5 tentativas por código.
- Intervalo mínimo de 60 segundos para reenviar.
- Hash do código armazenado no banco; o código em texto puro não é persistido.
- A conta e a sessão só são criadas depois da confirmação.
