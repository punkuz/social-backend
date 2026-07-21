export interface ChatMessageCreatedEvent {
  eventName: 'chat.message.created';
  eventVersion: 1;
  messageId: string;
  clientMessageId: string;
  conversationId: string;
  senderId: number;
  content: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface MessageAttachment {
  kind: 'photo' | 'file';
  url: string;
  name: string;
  mimeType: string;
  size: number;
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

  if (typeof value.content !== 'string' || value.content.length > 4_000) {
    throw new Error('Invalid content');
  }

  if (!isValidAttachments(value.attachments)) {
    throw new Error('Invalid attachments');
  }

  if (
    value.content.trim().length === 0 &&
    (!Array.isArray(value.attachments) || value.attachments.length === 0)
  ) {
    throw new Error('Message must contain content or attachments');
  }

  if (
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    throw new Error('Invalid createdAt');
  }

  return value as unknown as ChatMessageCreatedEvent;
}

function isValidAttachments(value: unknown): value is MessageAttachment[] {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.length <= 5 &&
    value.every(
      (attachment) =>
        isRecord(attachment) &&
        (attachment.kind === 'photo' || attachment.kind === 'file') &&
        isStringWithin(attachment.url, 1, 500) &&
        /^\/api\/v1\/chat\/uploads\/(photos|files)\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,10})?$/.test(
          attachment.url,
        ) &&
        ((attachment.kind === 'photo' && attachment.url.includes('/photos/')) ||
          (attachment.kind === 'file' && attachment.url.includes('/files/'))) &&
        isStringWithin(attachment.name, 1, 255) &&
        isStringWithin(attachment.mimeType, 1, 150) &&
        Number.isInteger(attachment.size) &&
        (attachment.size as number) > 0 &&
        (attachment.size as number) <= 20 * 1024 * 1024,
    )
  );
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
