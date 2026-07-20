export interface ChatMessageCreatedEvent {
  eventName: 'chat.message.created';
  eventVersion: 1;
  messageId: string;
  clientMessageId: string;
  conversationId: string;
  senderId: number;
  content: string;
  createdAt: string;
}

export function parseChatMessageCreatedEvent(
  rawValue: Buffer | null,
): ChatMessageCreatedEvent {
  if (!rawValue) {
    throw new Error('Kafka message value is empty');
  }

  let value: unknown;

  try {
    value = JSON.parse(rawValue.toString('utf8')) as unknown;
  } catch {
    throw new Error('Kafka message value is not valid JSON');
  }

  if (!isRecord(value)) {
    throw new Error('Kafka message value must be an object');
  }

  if (value.eventName !== 'chat.message.created' || value.eventVersion !== 1) {
    throw new Error('Unsupported chat message event');
  }

  if (
    typeof value.messageId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.messageId)
  ) {
    throw new Error('Invalid messageId');
  }

  if (!isStringWithin(value.clientMessageId, 1, 128)) {
    throw new Error('Invalid clientMessageId');
  }

  if (!isStringWithin(value.conversationId, 1, 128)) {
    throw new Error('Invalid conversationId');
  }

  if (!isPositiveInteger(value.senderId)) {
    throw new Error('Invalid senderId');
  }

  if (
    !isStringWithin(value.content, 1, 4_000) ||
    value.content.trim().length === 0
  ) {
    throw new Error('Invalid content');
  }

  if (
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    throw new Error('Invalid createdAt');
  }

  return value as unknown as ChatMessageCreatedEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringWithin(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}
