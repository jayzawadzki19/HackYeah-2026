import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { IngestService } from './ingest.service';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly ingest: IngestService) {}

  @Post('open-wearables')
  @HttpCode(204)
  receive(@Req() request: RawBodyRequest<Request>): void {
    this.ingest.receive(request.rawBody, request.headers);
  }
}
