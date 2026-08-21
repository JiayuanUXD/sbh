/**
 * exceljs 自带的 index.d.ts 顶部有一行全局声明合并：
 *   declare interface Buffer extends ArrayBuffer {}
 * 这会把 @types/node 的 Buffer 接口也强行要求满足 ArrayBuffer 的形状（比如
 * `slice(): ArrayBuffer`），而真实的 Node Buffer 的 `slice()` 返回的是
 * `Buffer<ArrayBuffer>`（属于 Uint8Array 家族，`Symbol.toStringTag` 是
 * "Uint8Array" 不是 "ArrayBuffer"）。结果是被污染后的 `Buffer` 类型连它自己
 * 都无法结构化匹配——任何真实 Buffer 值传给 `workbook.xlsx.load(buffer: Buffer)`
 * 都会报 TS2345，跟我们自己的类型推断/断言无关，是 exceljs 类型定义的上游缺陷。
 *
 * 这里不强行断言（`as Buffer` / `as unknown as Buffer` 依然会撞上同一处冲突），
 * 而是给 `Xlsx.load` 追加一条更宽松、结构上真实成立的重载：真实 Buffer 本来就是
 * Uint8Array 的子类型，用 Uint8Array 重载可以绕开那行坏掉的全局声明合并——原有的
 * `Buffer` 重载结构不匹配时，TS 重载解析会依次退回尝试这条新增重载，最终解析成功。
 */
import 'exceljs'

declare module 'exceljs' {
  interface Xlsx {
    load(
      buffer: Uint8Array,
      options?: Partial<import('exceljs').XlsxReadOptions>,
    ): Promise<import('exceljs').Workbook>
  }
}
