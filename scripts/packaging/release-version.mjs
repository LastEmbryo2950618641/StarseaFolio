/** Source versions stay fixed; only the packaged product receives the build suffix. */
export function windowsBuildIdentity(baseVersion, buildNumber) {
  if (!/^\d+\.\d+\.\d+$/u.test(baseVersion)) throw new Error("Invalid base version")
  const build = Number(buildNumber)
  if (!/^\d+$/u.test(String(buildNumber)) || !Number.isSafeInteger(build) || build < 1 || build > 65535) {
    throw new Error("Windows build number must be an integer between 1 and 65535")
  }
  return { baseVersion, version: `${baseVersion}-${build}`, buildNumber: String(build), windowsVersion: `${baseVersion}.${build}` }
}

/** A single serialized release workflow allocates numbers across branches and reruns. */
export function nextReleaseBuild(runNumber, releases) {
  let highest = 0
  for (const release of releases) {
    const suffix = /^v\d+\.\d+\.\d+-(\d+)$/u.exec(release.tag_name ?? "")?.[1]
    const legacy = /\(build (\d+)\)/u.exec(release.name ?? "")?.[1]
    highest = Math.max(highest, Number(suffix ?? legacy ?? 0))
  }
  return Math.max(Number(runNumber) || 1, highest + 1)
}
