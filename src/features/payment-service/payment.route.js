import { Router } from 'express';
import { validateCreatePayment } from './payment.validator.js';
import { createPayment, getPayment } from './payment.controller.js';

const router = Router();

router.post('/', validateCreatePayment, createPayment);
router.get('/:transactionId', getPayment);

export default router;
