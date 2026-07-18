import { RpcException } from '@nestjs/microservices';
import { HttpStatus } from '@nestjs/common';

export class HttpRpcException extends RpcException {
  constructor(
    message: string,
    private readonly statusCode: HttpStatus,
  ) {
    super({ message, statusCode });
  }

  getStatusCode(): number {
    return this.statusCode;
  }

  static badRequest(message: string): HttpRpcException {
    return new HttpRpcException(message, HttpStatus.BAD_REQUEST);
  }

  static unauthorized(message: string): HttpRpcException {
    return new HttpRpcException(message, HttpStatus.UNAUTHORIZED);
  }

  // Add more static methods for other common HTTP status codes as needed
  static forbidden(message: string): HttpRpcException {
    return new HttpRpcException(message, HttpStatus.FORBIDDEN);
  }

  static notFound(message: string): HttpRpcException {
    return new HttpRpcException(message, HttpStatus.NOT_FOUND);
  }

  static internalServerError(
    message = 'Internal Server Error',
  ): HttpRpcException {
    return new HttpRpcException(message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
