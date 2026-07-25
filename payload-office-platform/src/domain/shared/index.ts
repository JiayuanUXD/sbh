/**
 * 共享领域原语 barrel
 *
 * 9 个领域目录统一从 @/domain/shared 导入基础类型与工具，避免循环依赖。
 * 领域目录内业务代码不直接互相引用；跨领域协作走显式 service 接口。
 */
export * from './errors'
export * from './result'
export * from './time'
export * from './phone'
export * from './money'
export * from './validity'
