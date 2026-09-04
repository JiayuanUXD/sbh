function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.getPrototypeOf(value) === Object.prototype
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function inspectAcceptanceNode(value, path, failures) {
  if (!isPlainObject(value)) {
    failures.push(`${path} 不是普通对象叶节点`)
    return
  }

  if (hasOwn(value, 'passed')) {
    if (value.passed !== true) failures.push(`${path}.passed 不是 true`)
    return
  }

  const entries = Object.entries(value)
  if (entries.length === 0) {
    failures.push(`${path} 没有验收叶节点`)
    return
  }

  for (const [key, child] of entries) {
    inspectAcceptanceNode(child, `${path}.${key}`, failures)
  }
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
  } else {
    inspectAcceptanceNode(testCases, 'testCases', failures)
  }

  if (!isPlainObject(interactions)) {
    failures.push('interactions 必须是普通对象')
  } else if (Object.keys(interactions).length > 0) {
    inspectAcceptanceNode(interactions, 'interactions', failures)
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
