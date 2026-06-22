const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
};

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  handleValidationErrors,
];

const validateProduct = [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('description').optional().trim(),
  body('content_type').isIn(['ebook', 'link', 'download', 'video', 'course']).withMessage('Invalid content type'),
  body('content_url').optional().trim(),
  body('cover_url').optional().trim(),
  body('default_checkout_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Valid default checkout ID required'),
  body('checkout_ids').optional().isArray().withMessage('checkout_ids must be an array'),
  body('checkout_ids.*').optional().isUUID().withMessage('Valid checkout ID required'),
  body('upsell_product_ids').optional().isArray().withMessage('upsell_product_ids must be an array'),
  body('upsell_product_ids.*').optional().isUUID().withMessage('Valid upsell product ID required'),
  body('downsell_product_ids').optional().isArray().withMessage('downsell_product_ids must be an array'),
  body('downsell_product_ids.*').optional().isUUID().withMessage('Valid downsell product ID required'),
  body('order_bump_product_ids').optional().isArray().withMessage('order_bump_product_ids must be an array'),
  body('order_bump_product_ids.*').optional().isUUID().withMessage('Valid order bump product ID required'),
  body('status').optional().isIn(['active', 'pending', 'inactive']).withMessage('Invalid product status'),
  handleValidationErrors,
];

const validateCheckout = [
  body('name').trim().notEmpty().withMessage('Checkout name is required'),
  body('product_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Valid product ID required'),
  body('product_ids').optional().isArray().withMessage('product_ids must be an array'),
  body('product_ids.*').optional().isUUID().withMessage('Valid product ID required'),
  body('entity').trim().notEmpty().withMessage('Entity is required'),
  body('reference').trim().notEmpty().withMessage('Reference is required'),
  body('checkout_template').optional().trim(),
  body('payment_template').optional().trim(),
  body('is_default').optional().isBoolean().withMessage('is_default must be boolean'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('Invalid checkout status'),
  handleValidationErrors,
];

const validatePaymentSession = [
  body('product_id').isUUID().withMessage('Valid product ID required'),
  body('checkout_id').isUUID().withMessage('Valid checkout ID required'),
  body('customer_name').trim().notEmpty().withMessage('Customer name required'),
  body('customer_email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('customer_phone').optional().trim(),
  body('expected_amount').isFloat({ min: 0 }).withMessage('Expected amount must be positive'),
  handleValidationErrors,
];

const validateWebhook = [
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
  body('entity').optional().trim(),
  body('reference').optional().trim(),
  body('received_at').isISO8601().withMessage('Valid ISO date required'),
  body('raw_message').optional().trim(),
  body('sender').optional().trim(),
  handleValidationErrors,
];

const validateUpsell = [
  body('session_id').isUUID().withMessage('Valid session ID required'),
  body('action').isIn(['accept', 'decline']).withMessage('Action must be accept or decline'),
  handleValidationErrors,
];

module.exports = {
  validateLogin,
  validateProduct,
  validateCheckout,
  validatePaymentSession,
  validateWebhook,
  validateUpsell,
  handleValidationErrors,
};
