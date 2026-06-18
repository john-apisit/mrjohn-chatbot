import { Module } from '@nestjs/common';
import { SlipService } from './slip.service';

@Module({
  providers: [SlipService],
  exports: [SlipService],
})
export class SlipModule {}
