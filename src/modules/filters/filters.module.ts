import { Module } from '@nestjs/common';
import { FiltersController } from './filters.controller.js';
import { FiltersRepository } from './filters.repository.js';
import { FiltersService } from './filters.service.js';

@Module({
  controllers: [FiltersController],
  providers: [FiltersService, FiltersRepository],
  exports: [FiltersRepository],
})
export class FiltersModule {}
