import next from 'eslint-config-next'

/**
 * ESLint flat config（eslint-config-next 16 导出 flat config 数组）。
 *
 * 迁移背景：`next lint` 在 Next 16 已废弃，改用 `eslint .` 直接驱动
 * （见 package.json `lint` 脚本与 OPT-012）。
 */
const config = [
  ...next,
  {
    ignores: [
      'node_modules/',
      '.next/',
      'dist/',
      'build/',
      'artifacts/',
      'public/',
      'src/payload-types.ts',
      'src/migrations/**',
    ],
  },
]

export default config
