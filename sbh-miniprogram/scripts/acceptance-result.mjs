function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.getPrototypeOf(value) === Object.prototype
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function inspectAcceptanceNode(value, path, failures) {
  let markerCount = 0
  const hasPassed = hasOwn(value, 'passed')
  if (hasPassed) {
    markerCount += 1
    if (value.passed !== true) failures.push(`${path}.passed 不是 true`)
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'passed' || !isPlainObject(child)) continue
    markerCount += inspectAcceptanceNode(child, `${path}.${key}`, failures)
  }

  return markerCount
}

function resolvePath(value, path) {
  let current = value
  for (const segment of path.split('.')) {
    if (!isPlainObject(current) || !hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

export function assertAcceptancePassed(report) {
  if (!isPlainObject(report)) {
    throw new Error('验收报告必须是普通对象')
  }

  const failures = []
  const testCases = report.testCases
  const interactions = report.interactions

  if (!isPlainObject(testCases)) {
    failures.push('testCases 必须是普通对象')
  } else if (inspectAcceptanceNode(testCases, 'testCases', failures) === 0) {
    failures.push('testCases 没有验收结果')
  }

  if (!isPlainObject(interactions)) {
    failures.push('interactions 必须是普通对象')
  } else if (
    Object.keys(interactions).length > 0
    && inspectAcceptanceNode(interactions, 'interactions', failures) === 0
  ) {
    failures.push('interactions 没有验收结果')
  }

  const requiredInteractions = report.requiredInteractions
  if (requiredInteractions !== undefined) {
    if (
      !Array.isArray(requiredInteractions)
      || requiredInteractions.some((path) => typeof path !== 'string' || path.length === 0)
    ) {
      failures.push('requiredInteractions 必须是非空路径字符串数组')
    } else if (isPlainObject(interactions)) {
      for (const path of requiredInteractions) {
        const result = resolvePath(interactions, path)
        if (!isPlainObject(result) || result.passed !== true) {
          failures.push(`interactions.${path} 缺失或未通过`)
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`验收未通过：${failures.join('；')}`)
  }
}
