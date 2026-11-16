# Changelog

## 4.0.0-rc.1 — hardening e persistência
- PostgreSQL habilitado como backend de runtime via `DATABASE_URL`, mantendo snapshot JSONB compatível com a estrutura legada.
- Importador de JSON atualizado para preencher o snapshot de runtime sem apagar o arquivo original.
- Electron reforçado: servidor local restrito a loopback, permissões de câmera/microfone/tela limitadas à origem local e ícone ICO para Windows.
- Sinalização WebRTC recebe limite de taxa e validação de tamanho/formato de SDP e ICE candidate.
- Documentação de migração, CORS Android e critérios de release atualizada.
- Teste adicional garante que mutação com erro não grava estado parcial.

## 4.0.0-rc.2 — preparação para hospedagem gratuita
- Blueprint Render Free e documentação passo a passo para Supabase e Cloudflare R2.
- Armazenamento S3 compatível para avatares e anexos, evitando perda em disco efêmero.
- Health check `/healthz`, detecção da origem Render e teste automatizado do armazenamento local.
- Limitações dos planos gratuitos e dos endpoints públicos documentadas.
