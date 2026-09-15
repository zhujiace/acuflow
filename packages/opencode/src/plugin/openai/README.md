# OpenAI Responses WebSocket

> AcuFlow 说明：本仓库为基于 opencode 的医疗分支（成人非创伤性急腹症诊疗辅助）。本文件为 AcuFlow 内置能力的开发者说明。

Enabled by default on `local`, `dev`, and `beta`. On `latest` and `prod`, set `OPENCODE_EXPERIMENTAL_WEBSOCKETS=true`.

## Flow

1. A streamed `POST /responses` request arrives.
2. If it has no `session-id` or `x-session-affinity` header, use HTTP.
3. Title requests use HTTP.
4. If that session's socket is busy or already in fallback mode, use HTTP.
5. Otherwise, reuse its open socket or open a new one.
6. Send `response.create` and return WebSocket events as SSE.

## Lifetime

- Connect timeout: 15 seconds.
- Idle timeout: 5 minutes.
- After a completed response, keep the socket for reuse.
- Reuse a socket for up to 55 minutes, then replace it on the next request.

## Retries

- Retry WebSocket stream/setup failures up to 5 times, then use HTTP for that session until the pool entry is idle-pruned.
- `websocket_connection_limit_reached` consumes the same retry budget and HTTP fallback.
- If a WebSocket fails after its first event, fail it as retryable rather than replaying partial output in transport.
- Abort or cancel closes the socket.

## Next Steps

- `previous_response_id` continuation.
- Optional second WebSocket for concurrent requests in one session. Currently these use HTTP.
