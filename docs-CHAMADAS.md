# Infraestrutura de chamadas

## WebRTC P2P atual

O backend mantém sinalização autenticada por Socket.IO (`rtc:join-room`, `rtc:signal`, `rtc:leave-room`). A API `/api/rtc-config` entrega STUN e credenciais TURN temporárias compatíveis com coturn `use-auth-secret`. O cliente implementa perfect negotiation, fila de ICE e tentativa de ICE restart. A malha P2P não é adequada para grandes grupos: cada participante mantém conexões com os demais, elevando consumo de CPU, banda e bateria. Defina um limite operacional conservador até a integração SFU. TURN não vem incluído: sem ele, redes simétricas/restritivas podem impedir a chamada.

Variáveis: `STUN_URL`, `TURN_URLS`, `TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL`, `ICE_TRANSPORT_POLICY`.

## SFU preparada (LiveKit)

A rota autenticada `GET /api/sfu/config?roomId=<id>` valida acesso ao canal e gera JWT de curta duração. Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` apenas no backend. `docker-compose.sfu.yml` e `infra/livekit.yaml` são ponto de partida operacional.

**Importante:** a entrega prepara a infraestrutura do servidor e a emissão de tokens, mas o cliente atual ainda usa malha P2P. A integração de mídia LiveKit no frontend (LiveKit Client SDK, publicação/subscrição e UI de participantes) é uma etapa pendente; não anuncie SFU em produção até implementá-la e testá-la.
