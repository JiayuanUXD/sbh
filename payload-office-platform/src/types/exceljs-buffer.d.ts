/**
 * 最终评审 Minor 9（诊断纠正，修法与代码不变）：曾经诊断为
 *   exceljs 自带的 index.d.ts 顶部 `declare interface Buffer extends ArrayBuffer {}`
 *   "污染了 @types/node 的全局 Buffer 接口"。这个诊断是错的——实测证伪：
 *   exceljs 的 index.d.ts 因为顶层有 `export declare enum ...`，整份文件本身就是一个
 *   模块，该行 `declare interface Buffer` 又没有 `declare global {}` 包裹，所以只是
 *   **exceljs 这个模块内部的局部同名遮蔽**，不会外溢合并进 @types/node 的全局 `Buffer`。
 *   真正的问题是：exceljs 模块内的 `Buffer`（结构上等价于裸 ArrayBuffer 形状）与我们
 *   传入的真实 Node `Buffer`（`slice()` 返回 `Buffer<ArrayBuffer>`，属于 Uint8Array 家族）
 *   结构不匹配，导致 `workbook.xlsx.load(buffer: Buffer)` 在调用点报 TS2345，
 *   是 exceljs 类型定义的上游缺陷，跟我们自己的类型推断/断言无关。
 *   诊断错误的风险：会诱导后人去改 @types/node 或全局 Buffer 声明，那个方向从一开始
 *   就不是问题所在。
 *
 * 这里不强行断言（`as Buffer` / `as unknown as Buffer` 依然会撞上同一处冲突），
 * 而是给 `Xlsx.load` 追加一条更宽松、结构上真实成立的重载：真实 Buffer 本来就是
 * Uint8Array 的子类型，用 Uint8Array 重载可以绕开 exceljs 模块内那个局部的 `Buffer`
 * 遮蔽——原有的 `Buffer` 重载结构不匹配时，TS 重载解析会依次退回尝试这条新增重载，
 * 最终解析成功。
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
