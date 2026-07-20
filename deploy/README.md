# Chat deployment

This repository contains the application workloads only. Run Kafka, MongoDB,
Redis Cluster and RabbitMQ as replicated managed services in production.

## Required infrastructure

- Create `chat.messages.v1` and `chat.receipts.v1` with enough partitions for
  the measured peak throughput. Both topics are keyed by `conversationId`, so
  message and receipt order is preserved per conversation.
- Create `chat.messages.dlq.v1` and alert whenever it receives an event.
- Create MongoDB indexes before rollout while `MONGODB_AUTO_INDEX=false`.
- Use Redis Cluster for presence, membership caching and Socket.IO sharded
  Pub/Sub.
- RabbitMQ queues are durable. If an existing queue was created as non-durable,
  deploy with a new `CHAT_QUEUE`/`USER_QUEUE` name instead of changing it in
  place.

## Build images

```sh
docker build --build-arg APP_NAME=realtime-gateway -t ghcr.io/your-org/realtime-gateway:<git-sha> .
docker build --build-arg APP_NAME=chat-service -t ghcr.io/your-org/chat-service:<git-sha> .
```

Replace the image names and domain in `deploy/k8s/chat-platform.yaml`.

## Secrets

Create `chat-platform-secrets` through your secret manager integration. It must
provide:

- `JWT_SECRET`, `MESSAGE_RECEIPT_SECRET`
- `REDIS_CLUSTER_NODES`, `RABBITMQ_URL`, `MONGODB_URI`, `KAFKA_BROKERS`
- `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` when SASL is enabled

Do not commit those values. Apply the workload after the secret exists:

```sh
MONGODB_URI='<production-uri>' node tools/mongo/create-chat-indexes.mjs
kubectl apply -f deploy/k8s/chat-platform.yaml
```

Scrape `/metrics` on both workloads and alert on Kafka consumer lag,
`chat_service_dead_letter_events_total`, dependency readiness failures, pod
restarts, MongoDB write latency and Redis/Kafka/RabbitMQ saturation.

The HPA values are safe starting points, not capacity claims. Set CPU/memory,
partition counts, MongoDB write capacity and replica limits from load-test data.

## Staging load test

Pre-create a conversation containing the synthetic user ID range, then run the
load generator from multiple machines or Kubernetes Jobs:

```sh
SOCKET_URLS='https://chat.example.com' \
CONVERSATION_ID='<load-test-conversation>' \
JWT_SECRET='<staging-only-secret>' \
CONNECTIONS=1000 MESSAGES_PER_SECOND=5000 DURATION_SECONDS=300 \
node tools/load/realtime-load.mjs
```

Never use this against production. Increase load gradually while watching p99
latency, Kafka lag, Redis CPU/network, MongoDB write latency and error rate.
