import { createHash, randomUUID } from 'node:crypto';
import { Kafka, Partitioners } from 'kafkajs';
import mongoose from 'mongoose';

const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
  .split(',')
  .map((broker) => broker.trim())
  .filter(Boolean);
const topic = process.env.KAFKA_CHAT_MESSAGES_TOPIC ?? 'chat.messages.v1';
const receiptTopic =
  process.env.KAFKA_CHAT_RECEIPTS_TOPIC ?? 'chat.receipts.v1';
const mongoUri =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/social_chat_e2e';
const messageCount = 1_000;
const runId = randomUUID();
const conversationId = `e2e:${runId}`;
const kafka = new Kafka({ clientId: `chat-storage-e2e-${process.pid}`, brokers });
const producer = kafka.producer({
  allowAutoTopicCreation: false,
  createPartitioner: Partitioners.DefaultPartitioner,
});

try {
  await Promise.all([producer.connect(), mongoose.connect(mongoUri)]);
  const collection = mongoose.connection.db.collection('chat_messages');
  const receiptCollection =
    mongoose.connection.db.collection('message_receipts');
  const events = Array.from({ length: messageCount }, (_, index) => {
    const senderId = (index % 10) + 1;
    const clientMessageId = `${runId}:${index}`;

    return {
      eventName: 'chat.message.created',
      eventVersion: 1,
      messageId: createHash('sha256')
        .update(`${senderId}:${clientMessageId}`)
        .digest('hex'),
      clientMessageId,
      conversationId,
      senderId,
      content: `E2E message ${index}`,
      createdAt: new Date().toISOString(),
    };
  });

  for (let startIndex = 0; startIndex < events.length; startIndex += 500) {
    const chunk = events.slice(startIndex, startIndex + 500);
    await producer.send({
      topic,
      acks: -1,
      messages: chunk.map((event) => ({
        key: event.conversationId,
        value: JSON.stringify(event),
        headers: {
          'event-name': event.eventName,
          'event-version': String(event.eventVersion),
        },
      })),
    });
  }

  await waitForCount(collection, conversationId, messageCount, 60_000);

  await producer.send({
    topic,
    acks: -1,
    messages: events.slice(0, 50).map((event) => ({
      key: event.conversationId,
      value: JSON.stringify(event),
    })),
  });
  await delay(2_000);

  const receiptEvents = events.slice(0, 100).flatMap((message) => [
    {
      eventName: 'chat.receipt.updated',
      eventVersion: 1,
      messageId: message.messageId,
      conversationId,
      senderId: message.senderId,
      userId: 10_001,
      status: 'delivered',
      occurredAt: new Date().toISOString(),
    },
    {
      eventName: 'chat.receipt.updated',
      eventVersion: 1,
      messageId: message.messageId,
      conversationId,
      senderId: message.senderId,
      userId: 10_001,
      status: 'seen',
      occurredAt: new Date().toISOString(),
    },
  ]);
  await producer.send({
    topic: receiptTopic,
    acks: -1,
    messages: receiptEvents.map((event) => ({
      key: event.conversationId,
      value: JSON.stringify(event),
    })),
  });
  await waitForReceiptCount(receiptCollection, conversationId, 100, 60_000);

  const finalCount = await collection.countDocuments({ conversationId });
  const receiptCount = await receiptCollection.countDocuments({
    conversationId,
    deliveredAt: { $exists: true },
    seenAt: { $exists: true },
  });
  if (finalCount !== messageCount) {
    throw new Error(
      `Idempotency check failed: expected ${messageCount}, found ${finalCount}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({ status: 'passed', publishedMessages: 1_050, storedMessages: finalCount, publishedReceipts: 200, storedReceipts: receiptCount })}\n`,
  );
} finally {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db
      .collection('chat_messages')
      .deleteMany({ conversationId });
    await mongoose.connection.db
      .collection('message_receipts')
      .deleteMany({ conversationId });
  }
  await Promise.allSettled([producer.disconnect(), mongoose.disconnect()]);
}

async function waitForCount(collection, targetConversationId, expected, timeout) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const count = await collection.countDocuments({
      conversationId: targetConversationId,
    });

    if (count === expected) {
      return;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${expected} MongoDB messages`);
}

async function waitForReceiptCount(
  collection,
  targetConversationId,
  expected,
  timeout,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const count = await collection.countDocuments({
      conversationId: targetConversationId,
      deliveredAt: { $exists: true },
      seenAt: { $exists: true },
    });

    if (count === expected) {
      return;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${expected} MongoDB receipts`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
