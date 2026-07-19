import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ClientModule } from './client/client.module';
import { ConfigModule } from '@nestjs/config';
import { UserController } from "./user/user.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    ClientModule,
  ],
  controllers: [UserController],
  providers: [],
})
export class AppModule {}
