const jwt = require('jsonwebtoken');

function makeToken(payload = { id: 1, role: 'admin', empresa_id: 1 }) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

module.exports = { makeToken };
