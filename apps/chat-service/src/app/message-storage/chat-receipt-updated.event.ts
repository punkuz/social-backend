export interface ChatReceiptUpdatedEvent {
  eventName: 'chat.receipt.updated';
  eventVersion: 1;
  messageId: string;
  conversationId: string;
  senderId: number;
  userId: number;
  status: 'delivered' | 'seen';
  occurredAt: string;
}

export function parseChatReceiptUpdatedEvent(
  rawValue: Buffer | null,
): ChatReceiptUpdatedEvent {
  if (!rawValue) {
    throw new Error('Kafka receipt value is empty');
  }

  let value: unknown;
  try {
    value = JSON.parse(rawValue.toString('utf8')) as unknown;
  } catch {
    throw new Error('Kafka receipt is not valid JSON');
  }
  if (!isRecord(value)) {
    throw new Error('Kafka receipt must be an object');
  }

  if (
    value.eventName !== 'chat.receipt.updated' ||
    value.eventVersion !== 1 ||
    typeof value.messageId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.messageId) ||
    typeof value.conversationId !== 'string' ||
    value.conversationId.length < 1 ||
    value.conversationId.length > 128 ||
    !Number.isInteger(value.senderId) ||
    (value.senderId as number) < 1 ||
    !Number.isInteger(value.userId) ||
    (value.userId as number) < 1 ||
    value.senderId === value.userId ||
    (value.status !== 'delivered' && value.status !== 'seen') ||
    typeof value.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(value.occurredAt))
  ) {
    throw new Error('Invalid chat receipt event');
  }

  return value as unknown as ChatReceiptUpdatedEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
