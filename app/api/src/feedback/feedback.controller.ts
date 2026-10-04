import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { AcceptActionResultDto, Rating, ReflectionResultDto } from '../../../contracts/api-contract';
import { UsersService } from '../users/users.service';
import { requireUserKey } from '../users/user-key';
import { z } from 'zod';
import { FeedbackService } from './feedback.service';

const reflectionBody = z.object({
  rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

@Controller('users')
export class FeedbackController {
  constructor(
    private readonly users: UsersService,
    private readonly feedback: FeedbackService,
  ) {}

  @Post(':key/meetings/:id/reflection')
  @HttpCode(201)
  async reflect(
    @Param('key') key: string,
    @Param('id') id: string,
    @Body({ schema: reflectionBody }) body: { rating: Rating },
  ): Promise<ReflectionResultDto> {
    return this.feedback.reflect(await this.user(key), id, body.rating);
  }

  @Post(':key/actions/:id/accept')
  @HttpCode(201)
  async accept(@Param('key') key: string, @Param('id') id: string): Promise<AcceptActionResultDto> {
    return this.feedback.accept(await this.user(key), id);
  }

  private async user(key: string) {
    const userKey = requireUserKey(key);
    await this.users.profile(userKey);
    return userKey;
  }
}
