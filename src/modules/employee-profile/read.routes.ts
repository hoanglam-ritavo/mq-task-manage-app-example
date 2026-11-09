import { Router } from 'express';
import { z } from 'zod';
import type { ProfileStore } from './webhook.js';
import { profileQuerySchema } from './read.schema.js';
import { AppError } from '../../shared/errors/app-error.js';

export function createProfileReadRouter(store: ProfileStore) {
  const router = Router();
  router.get('/', (req, res) => {
    const query = profileQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new AppError(
        400,
        'INVALID_PROFILE_QUERY',
        'Invalid profile pagination query.',
      );
    res.json(store.list(query.data.page, query.data.pageSize));
  });
  router.get('/:userId', (req, res) => {
    const id = z.uuid().safeParse(req.params.userId);
    if (!id.success)
      throw new AppError(400, 'INVALID_PROFILE_ID', 'Invalid employee UUID.');
    const profile = store.get(id.data);
    if (!profile)
      throw new AppError(
        404,
        'PROFILE_NOT_FOUND',
        'Employee profile is not in this process.',
      );
    res.json(profile);
  });
  return router;
}
