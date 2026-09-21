import { Router } from 'express';
import { validateCreatePayment } from './payment.validator.js';
import { createPayment, getPayment, getStats } from './payment.controller.js';

const router = Router();

router.post('/', validateCreatePayment, createPayment);
router.get('/stats', getStats); // must come before /:transactionId
router.get('/:transactionId', getPayment);

export default router;
