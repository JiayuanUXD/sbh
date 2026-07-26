/**
 * 领域代码总入口（barrel）
 *
 * 9 个领域目录按 design.md 划分（AGENTS.md §4）：
 *   auth / geography / supply / review / report / crm / workflow / analytics / audit
 *
 * 共享类型与工具：@/domain/shared
 *
 * M0 阶段：仅建立目录与共享类型，业务代码在 M1+ 引入。
 * 跨领域协作走显式 service 接口，不直接互相引用。
 */
export * from './shared'
