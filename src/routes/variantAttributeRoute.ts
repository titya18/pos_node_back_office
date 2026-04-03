import express from 'express';
import { validateVariantAttributeRequest } from '../middlewares/validation';
import { verifyToken, authorize } from '../middlewares/auth';

import {
    getAllVariantAttributesWithPagination,
    getAllVariantAttributes,
    getVariantAttributeById,
    upsertVariantAttribute,
    deleteVariantAttribute
} from '../controllers/variantAttributeController';

const router = express.Router();
router.use(verifyToken);

router.route('/all').get(getAllVariantAttributes);
router.route('/')
    .get(getAllVariantAttributesWithPagination)
    .post(authorize(['Variant-Attribute-Create']), validateVariantAttributeRequest, upsertVariantAttribute);
router.route('/:id')
    .get(getVariantAttributeById)
    .put(authorize(['Variant-Attribute-Edit']), validateVariantAttributeRequest, upsertVariantAttribute)
    .delete(authorize(['Variant-Attribute-Delete']), deleteVariantAttribute);

export default router;