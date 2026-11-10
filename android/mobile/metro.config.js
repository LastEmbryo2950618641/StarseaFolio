const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "../..")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]
config.resolver.disableHierarchicalLookup = true
config.resolver.extraNodeModules = {
  "@starseafolio/contracts": path.resolve(workspaceRoot, "common/packages/contracts"),
}
config.resolver.unstable_enablePackageExports = true

const contractsEntry = path.resolve(workspaceRoot, "common/packages/contracts/dist/index.js")
const upstreamResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@starseafolio/contracts") {
    return { type: "sourceFile", filePath: contractsEntry }
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
