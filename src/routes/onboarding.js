const express = require('express');
const router = express.Router();

const onboardingController = require('../controllers/onboardingController');
const onboardingRateLimiter = require('../middlewares/onboardingRateLimiter');
const protegerOnboarding = require('../middlewares/protegerOnboarding');

// Tenant creation is privileged: staging/production require a server-side
// secret, and fail closed when it has not been configured.
router.post('/', protegerOnboarding, onboardingRateLimiter, onboardingController.criarTenant);

module.exports = router;
