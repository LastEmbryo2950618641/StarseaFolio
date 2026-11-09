const { withAndroidManifest } = require("expo/config-plugins")

// The development client can connect to a user's LAN HTTP backend as well as HTTPS.
module.exports = (config) => withAndroidManifest(config, (mod) => {
  mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true"
  return mod
})
