const express = require('express');
const router = express.Router();

const onboardingController = require('../controllers/onboardingController');
const onboardingRateLimiter = require('../middlewares/onboardingRateLimiter');

router.post('/', onboardingRateLimiter, onboardingController.criarTenant);

module.exports = router;
