const router = require('express').Router();
const healthRoutes = require('./healthRoutes');
const videoRoutes = require('./videoRoutes')


router.use('/health', healthRoutes);
router.use('/video', videoRoutes);

module.exports = router;