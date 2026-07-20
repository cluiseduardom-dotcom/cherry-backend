const jwt = require('jsonwebtoken');

function makeToken(payload = { id: 1, role: 'admin' }) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

module.exports = { makeToken };
