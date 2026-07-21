import { parseChatMessageCreatedEvent } from './chat-message-created.event';

describe('parseChatMessageCreatedEvent', () => {
  it('accepts a supported chat message event', () => {
    const event = validEvent();

    expect(
      parseChatMessageCreatedEvent(Buffer.from(JSON.stringify(event))),
    ).toEqual(event);
  });

  it('rejects malformed and unsupported events', () => {
    expect(() => parseChatMessageCreatedEvent(Buffer.from('{'))).toThrow(
      'not valid JSON',
    );
    expect(() =>
      parseChatMessageCreatedEvent(
        Buffer.from(JSON.stringify({ ...validEvent(), eventVersion: 2 })),
      ),
    ).toThrow('Unsupported chat message event');
  });

  it('accepts an attachment-only message', () => {
    const event = {
      ...validEvent(),
      content: '',
      attachments: [validAttachment()],
    };

    expect(
      parseChatMessageCreatedEvent(Buffer.from(JSON.stringify(event))),
    ).toEqual(event);
  });

  it('rejects a message without text or attachments', () => {
    expect(() =>
      parseChatMessageCreatedEvent(
        Buffer.from(JSON.stringify({ ...validEvent(), content: '' })),
      ),
    ).toThrow('content or attachments');
  });
});

function validEvent() {
  return {
    eventName: 'chat.message.created',
    eventVersion: 1,
    messageId: 'a'.repeat(64),
    clientMessageId: 'client-message-1',
    conversationId: 'dm:1:2',
    senderId: 1,
    content: 'Hello',
    createdAt: '2026-07-20T10:00:00.000Z',
  };
}

function validAttachment() {
  return {
    kind: 'photo',
    url: `/api/v1/chat/uploads/photos/${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}.jpg`,
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
  };
}
