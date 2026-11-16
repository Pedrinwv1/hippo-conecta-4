# PostgreSQL e preservação de dados — HIPPO CONECTA 4.0

O backend agora aceita PostgreSQL em runtime quando `DATABASE_URL` está definido. O estado completo da aplicação é persistido transacionalmente em `hc_state.payload` (JSONB), preservando a estrutura legada `users`, `servers` e `messages`. As tabelas relacionais `hc_users`, `hc_servers`, `hc_channels`, `hc_server_members` e `hc_messages` também são preenchidas pelo importador para facilitar consultas e evolução do modelo.

## Migração segura
1. Pare o backend antigo e faça backup de `server/data.json` e de `public/uploads`.
2. Crie um banco PostgreSQL 14+ e configure `DATABASE_URL`. Em produção, use `PGSSL=true` com certificado confiável.
3. Instale dependências com `npm ci` (o pacote `pg` está listado como opcional; instale-o explicitamente se necessário: `npm install pg`).
4. Execute `npm run db:migrate:postgres`. O importador executa em transação e não remove nem altera o JSON original.
5. Compare as contagens e valide amostras antes de apontar o serviço para PostgreSQL.
6. Reinicie o backend com `DATABASE_URL` definido. Na inicialização ele carrega `hc_state`; mutações seguintes são gravadas no PostgreSQL.

## Limitações importantes
- O adaptador atual mantém um snapshot JSONB único para preservar compatibilidade com os handlers síncronos existentes. É uma etapa de transição, não o modelo relacional final.
- Execute somente uma instância do backend por banco: múltiplas instâncias podem manter snapshots em memória divergentes e sobrescrever alterações. Para escalar, é necessária uma migração para repositórios transacionais por entidade e coordenação de Socket.IO via Redis.
- Configure backups automáticos, restauração testada, TLS e monitoramento do PostgreSQL antes de produção.
- O modo JSON continua disponível quando `DATABASE_URL` não está definido; em produção, não use armazenamento local efêmero.
