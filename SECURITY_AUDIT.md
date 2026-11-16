# Auditoria de segurança — HIPPO CONECTA 4.0

## Controles identificados no código-base
- Senhas com bcryptjs; JWT com emissor e segredo configurável.
- Cabeçalhos básicos de proteção, limite de payload JSON e CORS configurável.
- Socket.IO autentica JWT e verifica associação ao canal antes de entrar/sinalizar.
- Uploads limitados por tamanho e MIME, com validação simples de assinatura para avatar.
- Sinalização RTC restringe destino a participante da mesma sala.

## Riscos e ações necessárias antes de produção
1. O armazenamento JSON e o rate limit em memória não suportam múltiplas réplicas; use banco/limitador compartilhados.
2. Upload de anexos valida MIME declarado, não faz antivírus nem inspeção profunda; armazenar fora da pasta pública e servir por endpoint autenticado é recomendado.
3. Adicionar CSP estrita após inventariar scripts inline; hoje há muitos handlers inline e Socket.IO servido pelo backend.
4. Revisar autorização de todas as operações de servidor/canal e política de convite; executar teste de penetração externo.
5. Usar HTTPS, CORS explícito, JWT_SECRET aleatório de 32+ caracteres, TURN com segredo rotacionável e PostgreSQL com TLS.
6. Não armazenar segredos no APK/cliente. Chaves LiveKit e TURN ficam somente no backend.
7. Configurar backup, retenção, logs sem tokens/senhas, alertas e rotação de credenciais.

Esta auditoria é estática e não equivale a pentest nem certificação de segurança.
