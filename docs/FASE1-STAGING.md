# Fase 1 — preparação de validação isolada (STAGING)

## Limites
- Projeto Supabase permitido: `msnhqsopecmcccdabmcs`.
- Projeto de produção `fnxddxknngfuqvzawlni` está fora do escopo.
- Não configurar Render de produção, não fazer deploy e não alterar a branch `main`.
- Esta preparação não executa testes funcionais nem cria/edita dados no banco.

## Branch de trabalho
`staging/rls-validation`, criada a partir de `main`. Use-a para a preparação; não faça merge em `main` sem autorização.

## Ambiente local
1. Copie `staging.env.example` para `.env`.
2. Substitua `SENHA_DO_STAGING` pela senha do usuário do pooler de staging.
3. Gere um JWT_SECRET aleatório de pelo menos 64 caracteres.
4. Mantenha `REQUIRE_POSTGRES=true`.
5. Mantenha `UPLOAD_DIR=./.staging-uploads`; não configure chaves/buckets de produção.
6. Não compartilhe o arquivo `.env`, connection string, senha ou tokens.

O template usa o pooler de staging: host `aws-0-sa-east-1.pooler.supabase.com`, usuário `postgres.msnhqsopecmcccdabmcs`, banco `postgres`, porta `5432`. A senha não está incluída.

## Inicialização no Windows PowerShell
O repositório já documenta `npm.cmd` para contornar a política que bloqueia `npm.ps1`:
```powershell
npm.cmd install
npm.cmd run check
npm.cmd test
npm.cmd start
```
A inicialização com `REQUIRE_POSTGRES=true` deve falhar se `DATABASE_URL` não estiver definido e deve registrar:
`[db] PostgreSQL conectado; estado carregado.`

## Pré-requisitos dos testes funcionais
- Login: credenciais válidas de uma conta existente no snapshot do staging.
- Cadastro: Resend de teste configurado e remetente verificado. Sem isso, o endpoint de cadastro retorna erro de configuração; não contornar a verificação de e-mail em produção.
- Mensagens/reação/exclusão: usuário de teste com acesso ao canal e sessão autenticada.
- Criar servidor/convite: duas contas de teste para validar entrada por convite.
- Upload/avatar: armazenamento local isolado em `.staging-uploads`; isso testa o fluxo HTTP e a gravação local, não um bucket remoto.
- Reinicialização: confirmar que a tabela `hc_state` preserva os dados e que `updated_at` avança após uma mutação.

## Baseline conhecido
- Usuários: 8
- Servidores: 2
- Mensagens: 71 (todas em `ch-geral`)
- Cadastros pendentes: 0
- Linhas em `public.hc_state`: 1
- RLS: habilitado
- Políticas: 0
- `anon` e `authenticated`: sem SELECT/INSERT/UPDATE/DELETE na tabela.

## Rollback documentado (somente staging)
```sql
ALTER TABLE public.hc_state DISABLE ROW LEVEL SECURITY;
```
Manter os REVOKE. Não restaurar grants para `anon`/ `authenticated` sem autorização expressa.

## Regras para Fase 2
Toda tabela nova em `public` deve ser criada na migration com:
```sql
ALTER TABLE public.nome_da_tabela ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.nome_da_tabela FROM anon, authenticated;
```
