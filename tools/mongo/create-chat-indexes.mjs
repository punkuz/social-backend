import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error('MONGODB_URI is required');
}

const client = new MongoClient(uri);
try {
  await client.connect();
  const database = client.db();

  await Promise.all([
    database.collection('chat_messages').createIndexes([
      { key: { messageId: 1 }, unique: true },
      {
        key: { senderId: 1, clientMessageId: 1 },
        unique: true,
      },
      {
        key: { conversationId: 1, createdAt: -1, _id: -1 },
      },
    ]),
    database.collection('message_receipts').createIndexes([
      {
        key: { messageId: 1, userId: 1 },
        unique: true,
      },
      {
        key: { conversationId: 1, userId: 1, updatedAt: -1 },
      },
    ]),
    database.collection('conversations').createIndexes([
      {
        key: { conversationId: 1 },
        unique: true,
      },
      {
        key: { directKey: 1 },
        unique: true,
        sparse: true,
      },
      { key: { memberIds: 1, updatedAt: -1 } },
    ]),
  ]);

  process.stdout.write('{"status":"chat indexes ready"}\n');
} finally {
  await client.close();
}
