
const paradive = require("./paradive");
const deepstation = require("./deepstation");

async function getAvailability(provider, date, req) {
  if (provider === "paradive") return paradive.getAvailability(date, req);
  if (provider === "deepstation") return deepstation.getAvailability(date, req);

  const error = new Error("지원하지 않는 시설입니다.");
  error.statusCode = 400;
  throw error;
}

module.exports = {
  closeBrowsers: deepstation.closeBrowser,
  getAvailability,
  testPlaywrightChromium: deepstation.testChromium
};
