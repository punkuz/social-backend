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
