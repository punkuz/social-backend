import * as bcrypt from 'bcryptjs';

import { BeforeInsert, BeforeUpdate, Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';
import { IsEmail, IsEnum, IsNotEmpty, Length } from 'class-validator';
import { RpcException } from '@nestjs/microservices';
import { HttpRpcException } from "../../exceptions/http.rpc.exception";

@Entity()
export class User extends BaseEntity {
  @Column({ length: 350, unique: true })
  @IsNotEmpty({ message: 'Please enter your username!' })
  username!: string;

  @Column({ unique: true })
  @IsEmail({}, { message: 'Please provide a valid email!' })
  email!: string;

  @Column({ nullable: true })
  uniqueSlug?: string;

  @Column({ type: 'enum', enum: ['user', 'admin', 'guide'], default: 'user' })
  @IsNotEmpty({ message: 'Please provide a role!' })
  @IsEnum(['user', 'admin', 'guide'], {
    message: "Role must be either 'user' or 'admin' or 'guide'!",
  })
  role!: 'user' | 'admin' | 'guide';

  @Column({ select: false })
  @IsNotEmpty({ message: 'Please provide a password!' })
  @Length(8, 50, { message: 'Password must be between 8 and 50 characters!' })
  password!: string;

  @Column({ select: false, nullable: true })
  @IsNotEmpty({ message: 'Please confirm your password!' })
  passwordConfirm?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastLogin?: Date;

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.password !== this.passwordConfirm) {
      throw HttpRpcException.badRequest('Passwords do not match!');
    }
    if (this.password && this.password.length >= 8) {
      try {
        this.password = await bcrypt.hash(this.password, 12);
      } catch (error) {
        throw new RpcException(error as object);
      }
    }
    this.passwordConfirm = undefined; // Assign `null` instead of `undefined`
  }
}
