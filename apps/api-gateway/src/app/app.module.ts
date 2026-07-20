import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ClientModule } from './client/client.module';
import { ConfigModule } from '@nestjs/config';
import { UserController } from './user/user.controller';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['apps/api-gateway/.env', '.env'],
      isGlobal: true,
    }),
    AuthModule,
    ClientModule,
    ChatModule,
  ],
  controllers: [UserController],
  providers: [],
})
export class AppModule {}
