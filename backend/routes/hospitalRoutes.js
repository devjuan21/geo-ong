const express = require('express');
const { getHospitals, getHospitalById, getDestinationRecommendations } = require('../controllers/hospitalController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/recommendations', getDestinationRecommendations);
router.get('/', getHospitals);
router.get('/:id', getHospitalById);

module.exports = router;
