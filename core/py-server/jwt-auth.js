/** Desktop-local identity middleware shared by Python tool routes. */

const LOCAL_USER = Object.freeze({
  id: 'local-user',
  username: 'Local User',
  role: 'admin',
});

function attachLocalUser(req, _res, next) {
  req.user = LOCAL_USER;
  next();
}

module.exports = {
  jwtAuthRequired: attachLocalUser,
  jwtAuthOptional: attachLocalUser,
  LOCAL_USER,
};
