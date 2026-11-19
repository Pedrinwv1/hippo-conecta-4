# Relatório — Fase 1 RLS (STAGING)

Data da verificação: 2026-11-19
Projeto: `hippo-conecta-staging` (`msnhqsopecmcccdabmcs`)
Branch: `staging/rls-validation`

## Limites respeitados
- Nenhuma chamada ou alteração foi feita no projeto de produção `fnxddxknngfuqvzawlni`.
- Nenhuma alteração foi feita em `public.hc_state` durante esta execução.
- Nenhuma policy foi criada; nenhum GRANT foi restaurado.
- Nenhuma migração relacional/Fase 2 foi iniciada.

## Matriz de testes

| Teste | Status | Evidência resumida |
|---|---|---|
| Estado do projeto staging | EXECUTADO | Supabase informou `ACTIVE_HEALTHY`, PostgreSQL 17.11. |
| Papel da sessão SQL de auditoria | EXECUTADO | `current_user=postgres`, `session_user=postgres`, `rolbypassrls=true`, `rolsuper=false`. Isto identifica a sessão do executor SQL, não o processo Node do app. |
| Papel real usado pelo backend Node | NÃO EXECUTADO | O processo local não está acessível nesta sessão e a senha do pooler não está disponível para iniciar o backend. Não inferir que o backend usa `postgres` ou `service_role`. |
| RLS e proprietário de hc_state | EXECUTADO | `relrowsecurity=true`, `relforcerowsecurity=false`, proprietário `postgres`; 0 policies. |
| SELECT de hc_state pela sessão SQL | EXECUTADO | `count(*)=1` pela sessão `postgres` do executor SQL. Não substitui teste pela conexão Node. |
| Privilégios anon/authenticated | EXECUTADO | SELECT/INSERT/UPDATE/DELETE = false para ambos os papéis. |
| REST público GET /rest/v1/hc_state com anon key | NÃO EXECUTADO | Não há cliente HTTP arbitrário disponível nesta sessão para enviar a requisição com o header `apikey`. Portanto nenhum status HTTP nem código Postgres foi observado. |
| Inicialização do backend com REQUIRE_POSTGRES=true | NÃO EXECUTADO | Não foi possível executar comandos no PC local do usuário nem acessar o processo Node local. |
| Login com conta migrada | NÃO EXECUTADO | Depende do backend local e de credenciais de teste. |
| Cadastro + verificação de e-mail | NÃO EXECUTADO | Depende do backend local e de configuração válida de Resend/remetente. |
| Envio/reação/exclusão de mensagens | NÃO EXECUTADO | Depende de sessão autenticada no backend. |
| Criar servidor e entrar por convite | NÃO EXECUTADO | Depende do backend e de contas de teste. |
| Upload/avatar | NÃO EXECUTADO | Depende do backend; não foi criado arquivo de teste. |
| Reinicialização e persistência | NÃO EXECUTADO | Depende de executar o backend local conectado ao pooler de staging. |
| Contagens finais após mutações | NÃO EXECUTADO | Nenhuma mutação funcional foi executada; baseline foi reconsultado e permaneceu intacto. |
| Plano de rollback | EXECUTADO (documentado) | SQL preparado abaixo; não executado, pois nenhuma alteração nova foi feita nesta rodada. |

## Baseline confirmado no staging

Consulta direta a `public.hc_state`:
- Usuários: 8
- Servidores: 2
- Mensagens: 71
- Cadastros pendentes: 0
- Linhas em `public.hc_state`: 1
- `updated_at`: `2026-11-18 02:20:08.639249+00`

A consulta final confirmou os mesmos valores, sem alteração de `updated_at`.

## Falhas e bloqueios

1. **Papel do backend não comprovado:** a consulta administrativa executa como `postgres`; ela não revela a identidade da conexão criada por `pg.Pool` no processo Node.
2. **Teste REST não executado:** falta um cliente HTTP com capacidade de enviar o header `apikey`; não se deve inventar um 401/403 ou código 42501.
3. **Testes funcionais não executados:** o backend roda no computador local do usuário, inacessível a esta sessão. O template contém apenas placeholders para a senha do pooler e segredo JWT; nenhum segredo foi solicitado ou exposto.
4. **Cadastro por e-mail:** além do backend, requer credencial de teste do Resend e remetente verificado. Sem isso o endpoint de registro não pode concluir a verificação.

## Pendências de ação manual (um passo por item)

1. No computador que possui o repositório, copie `staging.env.example` para `.env` e preencha localmente a senha do pooler staging e um `JWT_SECRET` aleatório com pelo menos 64 caracteres. Não envie o arquivo, senha ou URL completa no chat.
2. Inicie o backend localmente com `npm.cmd install`, `npm.cmd run check`, `npm.cmd test` e depois `npm.cmd start`, mantendo `REQUIRE_POSTGRES=true`. Registre o log de inicialização e execute os testes autenticados usando contas de teste.
3. Para testar cadastro, configure localmente uma chave Resend de teste e remetente verificado; não compartilhe a chave.

## Rollback pronto — somente staging

Se for necessário reverter apenas a ativação de RLS em `hc_state`, executar no projeto `msnhqsopecmcccdabmcs`:

```sql
ALTER TABLE public.hc_state DISABLE ROW LEVEL SECURITY;
```

Não executar em produção. Manter todos os REVOKE existentes. Não restaurar privilégios para `anon` ou `authenticated`. O rollback não foi executado.

## Regra registrada para a Fase 2 (não iniciada)

Toda tabela nova no schema `public` deverá ser criada com RLS habilitado e privilégios públicos revogados na mesma migration:

```sql
ALTER TABLE public.nome_da_tabela ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.nome_da_tabela FROM anon, authenticated;
```

A criação de policies específicas deverá depender do modelo de autorização de cada tabela; não criar policies permissivas por padrão.

## Recomendação

**NÃO PRONTO para aplicar RLS em produção.** O teste administrativo no staging confirma o estado de RLS e os REVOKE, mas não comprova que o backend Node consegue operar com a identidade e privilégios reais, nem que a API REST bloqueia o papel público como esperado, nem que os fluxos funcionais persistem após reinicialização. Não promover nem replicar a configuração em produção até executar os itens pendentes e revisar evidências reais.
