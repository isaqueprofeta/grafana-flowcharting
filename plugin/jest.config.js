// force timezone to UTC to allow tests to work regardless of local timezone
process.env.TZ = 'UTC';

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...require('./.config/jest.config'),
};
